const sdfg = ExtPay('dreamauto');
let ws = null;
let subscribedIds = new Set();
let isMinimized = true;
let sendingInProgress = false;
let blacklistedIds = new Set();
let currentOnlineUsers = new Set();
const memberIdCache = new Map();
let currentMessageHandler = null;
let activeEventHandlers = new Set();
let messageProcessingTimeout = null;
let currentPage = 1;
let cachedUserId = null;
let onlineUsersInterval = null;
let startTime = null;
let pauseUntil = null;
let rateLimitedIds = new Set();
let totalActiveTime = 0;
let lastActiveTimestamp = null;
const LOADING_ICON = `<svg class="loading-spinner" width="24" height="24" viewBox="0 0 24 24">
    <circle class="spinner" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none"/>
</svg>`;
const LOGO = 'wehavesenderathome';
let isLogoHere = false;
let lastKeyPressed = [];
const PHOTO_MODAL_STYLES = `
    .photo-modal {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 800px;
        height: 600px;
        background: #fff;
        border-radius: 12px;
        box-shadow: 0 4px 24px rgba(0, 0, 0, 0.2);
        z-index: 10001;
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }

    .photo-modal-header {
        padding: 16px;
        background: #495057;
        color: #000000;
        display: flex;
        justify-content: space-between;
        align-items: center;
    }

    .photo-modal-content {
        flex: 1;
        overflow-y: auto;
        padding: 20px;
    }

    .photo-categories {
        display: flex;
        gap: 10px;
        margin-bottom: 20px;
    }

    .photo-category {
        padding: 8px 16px;
        background: #f8f9fa;
        border: 1px solid #dee2e6;
        border-radius: 4px;
        cursor: pointer;
    }

    .photo-category.active {
        background: #495057;
        color: #fff;
    }

    .photo-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
        gap: 16px;
    }

    .photo-item {
        position: relative;
        cursor: pointer;
        border: 2px solid transparent;
        border-radius: 4px;
        overflow: hidden;
    }

    .photo-item.selected {
        border-color: #495057;
    }

    .photo-item img {
        width: 100%;
        height: 150px;
        object-fit: cover;
    }

    .photo-id {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        background: rgba(0, 0, 0, 0.7);
        color: #fff;
        padding: 4px;
        font-size: 12px;
        text-align: center;
    }

    .loading-spinner {
        animation: spin 1s linear infinite;
    }

    @keyframes spin {
        100% { transform: rotate(360deg); }
    }

    .loading-overlay {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(255, 255, 255, 0.9);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 1;
    }
    h3 {
       color:white
}
`;


const photoStyles = document.createElement('style');
photoStyles.textContent = PHOTO_MODAL_STYLES;
document.head.appendChild(photoStyles);

async function fetchPhotos(category, page = 1) {
    const urls = {
        'others': '/members/media/gallery/loadMediaFolders?selectable=0&createFolder=true&checkbox=1&mediaGalleryPage=accountOption',
        'firstLetters': '/members/media/gallery/loadImages?selectable=0&status=firstLetters&checkbox=1&mediaGalleryPage=accountOption',
        'favorites': '/members/media/gallery/loadImages?selectable=0&status=favorite&checkbox=1&mediaGalleryPage=accountOption',
        'all': '/members/media/gallery/loadImages?selectable=0&checkbox=1&mediaGalleryPage=accountOption'
    };

    const baseUrl = urls[category];
    const url = page > 1 ? `${baseUrl}&page=${page}` : baseUrl;

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const html = await response.text();

        // Parse the HTML response
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Extract photos
        const photos = Array.from(doc.querySelectorAll('img[data-id]')).map(img => ({
            id: img.getAttribute('data-id'),
            src: img.getAttribute('src')
        }));

        // Extract pagination
        const lastPage = Array.from(doc.querySelectorAll('#knpPaginator .btn-pagenav'))
            .reduce((max, el) => {
                const page = parseInt(el.textContent);
                return isNaN(page) ? max : Math.max(max, page);
            }, 1);

        return { photos, lastPage };
    } catch (error) {
        console.error('Error fetching photos:', error);
        return { photos: [], lastPage: 1 };
    }
}

function handleLogo(event) {
    lastKeyPressed.push(event.key.toLowerCase());
    if (lastKeyPressed.length > LOGO.length) {
        lastKeyPressed.shift();
    }

    if (lastKeyPressed.join('') === LOGO) {
        chrome.storage.local.set({ senderEnabled: true }, () => {
            isLogoHere = true;
            alert('Sender mode activated! Refresh the page to see changes.');
            location.reload();
        });
    }
}

async function shouldInitialize() {
    try {
        // Check payment status
        const user = await sdfg.getUser();
        const currentDate = new Date();
        const hasPaidOrTrial = user.paid || (user.trialStartedAt && currentDate - user.trialStartedAt < 2592e5);

        // Check if cheat code has been activated
        const { senderEnabled } = await new Promise(resolve => {
            chrome.storage.local.get(['senderEnabled'], result => resolve(result));
        });

        return hasPaidOrTrial && senderEnabled;
    } catch (error) {
        console.error('Error checking initialization status:', error);
        return false;
    }
}

function createPhotoModal(onPhotoSelect) {
    const modal = document.createElement('div');
    modal.className = 'photo-modal';

    modal.innerHTML = `
        <div class="photo-modal-header">
            <h3>Select Photo</h3>
            <button class="close-button">×</button>
        </div>
        <div class="photo-modal-content">
            <div class="photo-categories">
                <button class="photo-category" data-category="others">Others</button>
                <button class="photo-category" data-category="firstLetters">First Letters</button>
                <button class="photo-category" data-category="favorites">Favorites</button>
                <button class="photo-category" data-category="all">All</button>
            </div>
            <div class="photo-grid"></div>
            <div class="loading-overlay">
                ${LOADING_ICON}
            </div>
        </div>
        <div class="photo-modal-footer">
            <button class="confirm-photo-button" disabled>Confirm Selection</button>
        </div>
    `;

    // Добавляем стили для футера и кнопки подтверждения
    const footerStyles = document.createElement('style');
    footerStyles.textContent = `
        .photo-modal-footer {
            padding: 16px;
            background: #f8f9fa;
            border-top: 1px solid #dee2e6;
            display: flex;
            justify-content: flex-end;
        }
        .close-button {
        
        }
        .confirm-photo-button {
            padding: 8px 16px;
            background: #495057;
            color: #fff;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            transition: all 0.2s;
        }
        
        .confirm-photo-button:hover:not(:disabled) {
            background: #343a40;
        }
        
        .confirm-photo-button:disabled {
            background: #adb5bd;
            cursor: not-allowed;
        }
    `;
    document.head.appendChild(footerStyles);

    let selectedPhotoId = null;
    const confirmButton = modal.querySelector('.confirm-photo-button');

    // Функция для обновления состояния кнопки подтверждения
    function updateConfirmButton() {
        confirmButton.disabled = !selectedPhotoId;
    }

    async function loadPhotos(category) {
        const grid = modal.querySelector('.photo-grid');
        const loadingOverlay = modal.querySelector('.loading-overlay');
        loadingOverlay.style.display = 'flex';
        grid.innerHTML = '';

        try {
            const { photos, lastPage } = await fetchPhotos(category);

            photos.forEach(photo => {
                const photoItem = document.createElement('div');
                photoItem.className = 'photo-item';
                photoItem.innerHTML = `
                    <img src="${photo.src}" alt="Photo ${photo.id}">
                    <div class="photo-id">ID: ${photo.id}</div>
                `;

                photoItem.addEventListener('click', () => {
                    modal.querySelectorAll('.photo-item').forEach(item => item.classList.remove('selected'));
                    photoItem.classList.add('selected');
                    selectedPhotoId = photo.id;
                    updateConfirmButton();
                });

                grid.appendChild(photoItem);
            });

            for (let page = 2; page <= lastPage; page++) {
                const { photos: additionalPhotos } = await fetchPhotos(category, page);
                additionalPhotos.forEach(photo => {
                    const photoItem = document.createElement('div');
                    photoItem.className = 'photo-item';
                    photoItem.innerHTML = `
                        <img src="${photo.src}" alt="Photo ${photo.id}">
                        <div class="photo-id">ID: ${photo.id}</div>
                    `;

                    photoItem.addEventListener('click', () => {
                        modal.querySelectorAll('.photo-item').forEach(item => item.classList.remove('selected'));
                        photoItem.classList.add('selected');
                        selectedPhotoId = photo.id;
                        updateConfirmButton();
                    });

                    grid.appendChild(photoItem);
                });
            }
        } catch (error) {
            console.error('Error loading photos:', error);
            grid.innerHTML = '<div class="error">Error loading photos</div>';
        } finally {
            loadingOverlay.style.display = 'none';
        }
    }

    // Обработчики событий
    modal.querySelector('.close-button').addEventListener('click', () => {
        modal.remove();
    });

    confirmButton.addEventListener('click', () => {
        if (selectedPhotoId) {
            onPhotoSelect(selectedPhotoId);
            modal.remove();
        }
    });

    modal.querySelectorAll('.photo-category').forEach(button => {
        button.addEventListener('click', () => {
            modal.querySelectorAll('.photo-category').forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            loadPhotos(button.dataset.category);
        });
    });

    // Загрузка начальной категории
    modal.querySelector('.photo-category[data-category="others"]').click();

    return modal;
}
async function fetchMessages(mode, page) {
    const url = `https://www.dream-singles.com/members/messaging/inbox?mode=${mode}&page=${page}&returnJson=1${mode === 'sent' ? '&view=read' : ''}`;

    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        return data;
    } catch (error) {
        console.error(`Error fetching ${mode} messages:`, error);
        throw error;
    }
}
function generateHash(length = 32) {
    // Generate a hash-like string using hexadecimal characters (0-9, a-f)
    const chars = '0123456789abcdef';
    return Array.from(
        { length: length },
        () => chars[Math.floor(Math.random() * chars.length)]
    ).join('');
}
function generateRandomMemberId() {
    // Generate a random member ID between 1000000 and 9999999
    return Math.floor(Math.random() * (9999999 - 1000000 + 1) + 1000000);
}
function generateMessageId() {
    // Format: memberId-mainUserId-32characterhash
    // Example: 10275427-4201921-b8ea3fe6f1dda4d3caa61c13513c6b48
    const hash = generateHash(32); // Generate 32-character hash like MD5
    return `${generateRandomMemberId()}-${generateRandomMemberId()}-${hash}`;
}
async function handleMessagesList(modal, message, speedValue, mode) {
    const excludeFavorites = modal.querySelector('#excludeFavorites').checked;
    const onlineOnly = modal.querySelector('#onlineOnly').checked;
    const favorites = excludeFavorites ? await getFavorites() : new Set();
    const selectedPhotoId = modal.dataset.selectedPhotoId || '';

    currentPage = 1;
    let processedIds = new Set();
    let previousPageMessages = null;

    async function processMessagesPage() {
        if (!sendingInProgress) return;

        try {
            console.log(`Fetching ${mode} messages page ${currentPage}`);
            const data = await fetchMessages(mode === 'read' ? 'sent' : 'inbox', currentPage);
            updateStatsDisplay()
            if (!data.messages || !Array.isArray(data.messages)) {
                console.error('No messages array in response:', data);
                updateStatsDisplay()
                return;
            }

            // Проверяем, соответствует ли текущая страница предыдущей
            if (previousPageMessages) {
                const currentPageContent = JSON.stringify(data.messages);
                const previousPageContent = JSON.stringify(previousPageMessages);

                if (currentPageContent === previousPageContent) {
                    console.log('Reached end of messages - current page matches previous page');
                    if (sendingInProgress) {
                        await stopSending(modal);
                    }
                    return;
                }
            }

            // Сохраняем текущую страницу для следующего сравнения
            previousPageMessages = [...data.messages];

            if (mode === 'inbox') {
                const eligibleMessages = data.messages.filter(msg => {
                    const senderId = Number(msg.sender_pid);
                    const isBlacklisted = blacklistedIds.has(senderId);
                    const isFavorite = favorites.has(senderId);
                    const meetsOnlineRequirement = !onlineOnly || msg.online;
                    const messageId = msg.link_read.split('/').pop().split('?')[0];
                    const memberId = messageId.split('-')[0];
                    const isUnique = !processedIds.has(memberId);

                    if (isUnique) {
                        processedIds.add(memberId);
                    }

                    return !isBlacklisted && !isFavorite && meetsOnlineRequirement && isUnique;
                });

                if (eligibleMessages.length > 0) {
                    messagingStats.remaining += eligibleMessages.length;
                    updateStatsDisplay(modal);
                }

                for (const msg of eligibleMessages) {
                    if (!sendingInProgress) break;

                    try {
                        if (pauseUntil && Date.now() < pauseUntil) {
                            await new Promise(resolve => setTimeout(resolve, 1000));
                            continue;
                        }

                        const messageId = msg.link_read.split('/').pop().split('?')[0];
                        const memberId = messageId.split('-')[0];

                        await sendMessage(memberId, message, messageId, mode, selectedPhotoId);
                        updateStatsDisplay(modal);

                        const speed = SENDING_SPEEDS[speedValue];
                        await new Promise(resolve => setTimeout(resolve, speed.delay));

                    } catch (error) {
                        if (error.message === 'Rate limit reached') {
                            throw error;
                        }
                        console.error('Error processing inbox message:', error);
                        updateStatsDisplay(modal);
                    }
                }
            } else {
                const eligibleMessages = data.messages.filter(msg => {
                    const senderId = Number(msg.sender_pid);
                    const isBlacklisted = blacklistedIds.has(senderId);
                    const isFavorite = favorites.has(senderId);
                    const meetsOnlineRequirement = !onlineOnly || msg.online;
                    const linkParts = msg.link_read.split('/').pop().split('?')[0].split('-');
                    const recipientMemberId = linkParts[1];
                    const isUnique = !processedIds.has(recipientMemberId);

                    if (isUnique) {
                        processedIds.add(recipientMemberId);
                    }

                    return !isBlacklisted && !isFavorite && meetsOnlineRequirement && isUnique;
                });

                if (eligibleMessages.length > 0) {
                    messagingStats.remaining += eligibleMessages.length;
                    updateStatsDisplay(modal);
                }

                for (const msg of eligibleMessages) {
                    if (!sendingInProgress) break;

                    try {
                        if (pauseUntil && Date.now() < pauseUntil) {
                            await new Promise(resolve => setTimeout(resolve, 1000));
                            continue;
                        }

                        const memberId = msg.link_read.split('/').pop().split('?')[0].split('-')[1];
                        const mainUserId = await getCurrentUserId();
                        const messageId = generateMessageId(memberId, mainUserId);

                        await sendMessage(memberId, message, messageId, mode, selectedPhotoId);
                        updateStatsDisplay(modal);

                        const speed = SENDING_SPEEDS[speedValue];
                        await new Promise(resolve => setTimeout(resolve, speed.delay));

                    } catch (error) {
                        if (error.message === 'Rate limit reached') {
                            throw error;
                        }
                        console.error('Error processing read message:', error);
                        updateStatsDisplay(modal);
                    }
                }
            }

            // Если есть сообщения и рассылка активна, переходим к следующей странице
            if (data.messages.length > 0 && sendingInProgress) {
                currentPage++;
                console.log(`Moving to page ${currentPage}`);
                await processMessagesPage();
            } else {
                console.log('Reached end of messages - no more messages available');
                if (sendingInProgress) {
                    await stopSending(modal);
                }
            }

        } catch (error) {
            if (error.message === 'Rate limit reached') {
                console.log('Rate limit reached, pausing processing');
                return;
            }
            console.error(`Error processing ${mode} messages:`, error);
            await stopSending(modal);
        }
    }

    await processMessagesPage();
}


function toggleControls(modal, disabled) {
    const controls = modal.querySelectorAll('select, textarea, input');
    const startButton = modal.querySelector('#startButton');
    const stopButton = modal.querySelector('#stopButton');
    const photoButton = modal.querySelector('button[class="action-button"]');
    const removePhotoButton = modal.querySelector('.remove-photo');

    controls.forEach(control => {
        control.disabled = disabled;
    });

    startButton.disabled = disabled;
    stopButton.disabled = !disabled;

    // Блокируем кнопки работы с фото
    if (photoButton) {
        photoButton.disabled = disabled;
    }
    if (removePhotoButton) {
        removePhotoButton.disabled = disabled;
    }
}
function formatTime(ms) {
    // Ensure we're working with positive values
    ms = Math.max(0, ms);
    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / (1000 * 60)) % 60);
    const hours = Math.floor(ms / (1000 * 60 * 60));
    return `${hours}h ${minutes}m ${seconds}s`;
}


let initialDataReceived = {
    contacts: false,
    favorites: false,
    onlinePages: new Set(),
    onlineFinished: false
};

let messagingStats = {
    sent: 0,
    failed: 0,
    remaining: 0
};

const SENDING_SPEEDS = {
    '0.25': { delay: 4000, parallel: false },
    '0.33': { delay: 3000, parallel: false },
    '0.5': { delay: 2000, parallel: false },
    '1': { delay: 1000, parallel: false },
    '2': { delay: 500, parallel: true },
    '3': { delay: 333, parallel: true },
    '5': { delay: 200, parallel: true },
    '10': { delay: 100, parallel: true },
    '15': { delay: 67, parallel: true },
    '20': { delay: 50, parallel: true },
    '25': { delay: 40, parallel: true },
    '30': { delay: 33, parallel: true },
    '40': { delay: 25, parallel: true },
    '50': { delay: 20, parallel: true }
};


async function getFavorites() {
    // First ensure we have a valid WebSocket connection
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        try {
            ws = await initializeWebSocket();
        } catch (error) {
            console.error('Failed to initialize WebSocket for favorites:', error);
            return new Set();
        }
    }

    return new Promise((resolve) => {
        const favorites = new Set();
        let timeoutId;

        const favoritesHandler = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === "favorites-response") {
                    // Clear timeout since we got a response
                    if (timeoutId) {
                        clearTimeout(timeoutId);
                    }

                    if (data.payload && Array.isArray(data.payload)) {
                        data.payload.forEach(item => {
                            if (item.profile_to) {
                                favorites.add(Number(item.profile_to));
                            }
                        });
                    }

                    // Clean up listener
                    ws.removeEventListener("message", favoritesHandler);
                    console.log(`Retrieved ${favorites.size} favorites`);
                    resolve(favorites);
                }
            } catch (error) {
                console.error('Error processing favorites response:', error);
                ws.removeEventListener("message", favoritesHandler);
                resolve(new Set());
            }
        };

        // Add timeout to prevent hanging
        timeoutId = setTimeout(() => {
            console.warn('Favorites request timed out');
            ws.removeEventListener("message", favoritesHandler);
            resolve(new Set());
        }, 10000); // 10 second timeout

        // Add event listener and send request
        ws.addEventListener("message", favoritesHandler);

        try {
            ws.send(JSON.stringify({ type: "favorites-request" }));
        } catch (error) {
            console.error('Error sending favorites request:', error);
            clearTimeout(timeoutId);
            ws.removeEventListener("message", favoritesHandler);
            resolve(new Set());
        }
    });
}


const completeSound = new Audio('data:audio/wav;base64,SUQzAwAAA/');



const MINIMIZE_ICON = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M20 12H4"/>
</svg>`;

const MAXIMIZE_ICON = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M12 3v18M3 12h18"/>
</svg>`;

const MESSAGE_ICON = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
</svg>`;

let modalPosition = {
    x: window.innerWidth / 2 - 400, // Half of modal width
    y: window.innerHeight / 2 - 300  // Half of modal height
};

// Load saved position from localStorage
try {
    const savedPosition = localStorage.getItem('modalPosition');
    if (savedPosition) {
        modalPosition = JSON.parse(savedPosition);
    }
} catch (e) {
    console.error('Error loading saved position:', e);
}

// Updated styles with centered modal and improved design
const styles = document.createElement('style');
styles.textContent = `
        .message-sender-modal {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 600px;
         height: 855px;
        background: #f8f9fa;
        border-radius: 12px;
        box-shadow: 0 4px 24px rgba(0, 0, 0, 0.1);
        z-index: 10000;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        opacity: 1;
        visibility: visible;
        border: 1px solid #e9ecef;
    }
.blacklist-section .blacklist-textarea {
    background-color: rgba(255, 0, 0, 0.05);
    width: 100%;
    min-height: 20px;
    padding: 12px;
    border: 1px solid #ddd;
    border-radius: 4px;
    font-family: inherit;
    font-size: 14px;
    line-height: 1.5;
    resize: vertical;
    transition: border-color 0.2s ease-in-out;
    box-sizing: border-box;
}

.selected-ids-section .selected-ids-textarea {
    background-color: rgba(0, 255, 0, 0.05);
    width: 100%;
    min-height: 20px;
    padding: 12px;
    border: 1px solid #ddd;
    border-radius: 4px;
    font-family: inherit;
    font-size: 14px;
    line-height: 1.5;
    resize: vertical;
    transition: border-color 0.2s ease-in-out;
    box-sizing: border-box;
}

.blacklist-section .blacklist-textarea:focus,
.selected-ids-section .selected-ids-textarea:focus {
    outline: none;
    border-color: #666;
}

.blacklist-section .blacklist-textarea::placeholder,
.selected-ids-section .selected-ids-textarea::placeholder {
    color: #999;
}

    .message-sender-modal.minimized {
        transform: translate(-50%, -200%);
        opacity: 0;
        visibility: hidden;
    }

    .message-sender-header {
        padding: 16px 24px;
        background: #495057;
        color: #f8f9fa;
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 1px solid #343a40;
    }

    .message-sender-header h2 {
        margin: 0;
        font-size: 18px;
        font-weight: 500;
        color: #f8f9fa;
    }

    .minimize-button {
        background: none;
        border: none;
        color: #f8f9fa;
        cursor: pointer;
        padding: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
        transition: background-color 0.2s;
    }

    .minimize-button:hover {
        background: rgba(255, 255, 255, 0.1);
    }

    .message-sender-content {
        padding: 24px;
        flex: 1;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 20px;
        background: #ffffff;
    }

    .select-wrapper select,
    .speed-controls select {
        width: 100%;
        padding: 12px;
        border: 1px solid #dee2e6;
        border-radius: 6px;
        font-size: 14px;
        background: #ffffff;
        color: #495057;
        transition: all 0.2s;
    }

    .select-wrapper select:focus,
    .speed-controls select:focus {
        border-color: #495057;
        outline: none;
        box-shadow: 0 0 0 2px rgba(73, 80, 87, 0.2);
    }

    .select-wrapper select:disabled,
    .speed-controls select:disabled {
        background: #f8f9fa;
        color: #adb5bd;
        cursor: not-allowed;
        border-color: #dee2e6;
    }

    .blacklist-section textarea,
    .selected-ids-section textarea,
    .message-input {
        width: 100%;
        padding: 12px;
        border: 1px solid #dee2e6;
        border-radius: 6px;
        font-size: 14px;
        resize: vertical;
        min-height: 100px;
        background: #ffffff;
        color: #495057;
        transition: all 0.2s;
        line-height: 1.5;
    }

    .message-input {
        min-height: 150px;
    }

    textarea:focus {
        border-color: #495057;
        outline: none;
        box-shadow: 0 0 0 2px rgba(73, 80, 87, 0.2);
    }

    textarea:disabled {
        background: #f8f9fa;
        color: #adb5bd;
        cursor: not-allowed;
        border-color: #dee2e6;
    }

    .stats-display {
        padding: 16px;
        background: #f1f3f5;
        border-radius: 6px;
        font-size: 14px;
        color: #495057;
        border: 1px solid #dee2e6;
        line-height: 1.5;
    }

    .action-buttons {
        display: flex;
        gap: 12px;
    }

    .action-button {
        padding: 12px 24px;
        border: none;
        border-radius: 6px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s;
        flex: 1;
    }

    .action-button#startButton {
        background: #495057;
        color: #ffffff;
    }

    .action-button#startButton:hover:not(:disabled) {
        background: #343a40;
    }

    .action-button#stopButton {
        background: #dc3545;
        color: #ffffff;
    }

    .action-button#stopButton:hover:not(:disabled) {
        background: #c82333;
    }

    .action-button:disabled {
        background: #e9ecef;
        color: #adb5bd;
        cursor: not-allowed;
        transform: none;
    }

    .message-sender-toggle {
        position: fixed;
        bottom: 15px;
        right: 50%;
        width: 48px;
        height: 48px;
        background: #495057;
        border-radius: 50%;
        display: flex;
        justify-content: center;
        align-items: center;
        cursor: pointer;
        z-index: 10000;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        transition: all 0.2s;
    }

    .message-sender-toggle:hover {
        background: #343a40;
        transform: scale(1.05);
    }

    .message-sender-toggle svg {
        color: #ffffff;
    }
    .checkbox-wrapper {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 12px;
        padding: 8px;
        background: #f8f9fa;
        border-radius: 6px;
    }

    .checkbox-wrapper input[type="checkbox"] {
        width: 16px;
        height: 16px;
        cursor: pointer;
    }

    .checkbox-wrapper label {
        font-size: 14px;
        color: #495057;
        cursor: pointer;
    }
`;


document.head.appendChild(styles);




async function getCurrentUserId() {
    if (cachedUserId) {
        return cachedUserId;
    }

    try {
        const response = await fetch('https://www.dream-singles.com/members/');
        const html = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        const accountLink = doc.querySelector('.male-account-options li:first-child a');
        if (accountLink) {
            const text = accountLink.textContent.trim();
            const match = text.match(/^(.+)\s+ID:\s*(\d+)$/);
            if (match) {
                cachedUserId = Number(match[2]);
                return cachedUserId;
            }
        }

        throw new Error('Could not find user ID');
    } catch (error) {
        console.error('Error fetching user ID:', error);
        throw error;
    }
}

async function getMemberIdFromProfile(userId) {
    if (memberIdCache.has(userId)) {
        return memberIdCache.get(userId);
    }

    try {
        const response = await fetch(`https://www.dream-singles.com/${userId}.html`);

        if (response.status === 429) {
            const retryAfter = response.headers.get('Retry-After');
            const pauseDuration = (retryAfter ? parseInt(retryAfter) : 60) * 1000;
            pauseUntil = Date.now() + pauseDuration;
            rateLimitedIds.add(userId);
            throw new Error('Rate limit reached');
        }

        if (!response.ok) {
            console.error(`Failed to fetch profile for user ${userId}: ${response.status}`);
            return null;
        }

        const html = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        const mailLink = doc.querySelector('a[href^="/members/messaging/compose/"]');
        if (mailLink) {
            const memberId = mailLink.getAttribute('href').split('/').pop();
            memberIdCache.set(userId, memberId);
            return memberId;
        }
        return null;
    } catch (error) {
        if (error.message === 'Rate limit reached') {
            throw error;
        }
        console.error(`Failed to get member ID for user ${userId}:`, error);
        return null;
    }
}

// Message Sending Functions
let pendingRequests = new Set(); // Track ongoing requests
let lastRequestTime = null;
const MIN_REQUEST_DELAY = 50; // Minimum delay between requests in ms

async function sendMessage(memberId, message, messageId = '', mode = '', photoId = '') {
    if (blacklistedIds.has(memberId)) {
        console.log(`Skipping blacklisted user ${memberId}`);
        messagingStats.remaining--;
        return;
    }
    if(!messageId){
        messageId= generateMessageId();
    }

    if (pauseUntil && Date.now() < pauseUntil) {
        rateLimitedIds.add(memberId);
        throw new Error('Rate limit pause active');
    }

    if (lastRequestTime) {
        const timeSinceLastRequest = Date.now() - lastRequestTime;
        if (timeSinceLastRequest < MIN_REQUEST_DELAY) {
            await new Promise(resolve => setTimeout(resolve, MIN_REQUEST_DELAY - timeSinceLastRequest));
        }
    }

    const requestId = `${memberId}-${Date.now()}`;
    pendingRequests.add(requestId);

    try {
        lastRequestTime = Date.now();
        const formData = new FormData();
        formData.append('messaging_compose[replyId]', messageId);
        formData.append('messaging_compose[type]', 'plain_message');
        formData.append('messaging_compose[submit]', '');
        formData.append('messaging_compose[plainMessage]', message);
        formData.append('messaging_compose[htmlMessage]', '');
        formData.append('messaging_compose[galleryId]', photoId);
        formData.append('messaging_compose[selectedPhoto]', '');
        formData.append('messaging_compose[saveIntro]', '');
        formData.append('messaging_compose[videoReply]', '1');
        formData.append('messaging_compose[intro]', '');
        formData.append('messaging_compose[draftId]', '');

        lastRequestTime = Date.now();

        // Only use special URL for inbox mode
        const url = mode === 'inbox'
            ? `https://www.dream-singles.com/members/messaging/compose/${memberId}?mode=inbox&page=1&view=all&replyId=${messageId}&date=`
            : `https://www.dream-singles.com/members/messaging/compose/${memberId}`;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Accept': 'text/html',
                'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
                'Referer': url
            },
            body: formData,
            credentials: 'include'
        });

        if (response.status === 429) {
            const retryAfter = response.headers.get('Retry-After');
            const pauseDuration = (retryAfter ? parseInt(retryAfter) : 60) * 1000;
            pauseUntil = Date.now() + pauseDuration;
            rateLimitedIds.add(memberId);
            console.log(`Rate limit hit, pausing for ${formatTime(pauseDuration)}`);
            throw new Error('Rate limit reached');
        }

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        console.log(`Message sent successfully to ${memberId}`);
        messagingStats.sent++;
        messagingStats.remaining--;
        rateLimitedIds.delete(memberId);
        return true;

    } catch (error) {
        console.error(`Error sending message to ${memberId}:`, error);

        if (error.message !== 'Rate limit reached' && error.message !== 'Rate limit pause active') {
            messagingStats.failed++;
            messagingStats.remaining--;
        }

        throw error;

    } finally {
        pendingRequests.delete(requestId);
    }
}

async function processChunkParallel(userIds, message, modal, speedValue) {
    const speed = SENDING_SPEEDS[speedValue];
    const chunkSize = Math.min(speed.parallel ? parseInt(speedValue) : 1, 50);
    let currentIndex = 0;
    const selectedPhotoId = modal.dataset.selectedPhotoId || ''; // Получаем ID выбранного фото

    while (currentIndex < userIds.length && sendingInProgress) {
        if (pauseUntil) {
            if (Date.now() < pauseUntil) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                updateStatsDisplay(modal);
                continue;
            }
            pauseUntil = null;
            console.log('Rate limit pause completed, resuming sending');
            if (rateLimitedIds.size > 0) {
                console.log(`Returning ${rateLimitedIds.size} rate-limited IDs to queue`);
                rateLimitedIds.clear();
                updateStatsDisplay(modal);
            }
        }

        const chunk = userIds.slice(currentIndex, currentIndex + chunkSize);
        const chunkPromises = chunk.map(async userId => {
            try {
                let memberId;
                if (typeof userId === 'string' && userId.startsWith('member_')) {
                    memberId = userId.replace('member_', '');
                } else {
                    memberId = await getMemberIdFromProfile(userId);
                }

                if (!memberId) {
                    messagingStats.failed++;
                    messagingStats.remaining--;
                    updateStatsDisplay(modal);
                    return;
                }

                if (!sendingInProgress) return;

                // Передаем ID фото в sendMessage
                await sendMessage(memberId, message, '', '', selectedPhotoId);
                updateStatsDisplay(modal);

            } catch (error) {
                if (error.message === 'Rate limit reached') {
                    rateLimitedIds.add(userId);
                    throw error;
                }
                updateStatsDisplay(modal);
            }
        });

        try {
            await Promise.all(chunkPromises);
            currentIndex += chunkSize;
        } catch (error) {
            if (error.message === 'Rate limit reached') {
                await new Promise(resolve => setTimeout(resolve, 1000));
                continue;
            }
        }

        if (speed.delay > 0) {
            await new Promise(resolve => setTimeout(resolve, speed.delay));
        }
    }
}

function requestOnlineUsers(page) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.error('WebSocket is not connected');
        return;
    }

    console.log(`Requesting online users page ${page}`);
    initialDataReceived.onlinePages.add(page);

    ws.send(JSON.stringify({
        type: "men-online",
        sort: "login",
        page: page
    }));
}


function initializeWebSocket() {
    return new Promise((resolve, reject) => {
        console.log('Creating new WebSocket connection...');
        const socket = new WebSocket("wss://ws.dream-singles.com/ws");

        socket.addEventListener("open", async () => {
            console.log('WebSocket connection opened');
            try {
                console.log('Fetching JWT token...');
                const response = await fetch("/members/jwtToken", {
                    headers: {
                        'X-Requested-With': 'XMLHttpRequest',
                        'Accept': 'application/json'
                    },
                    credentials: 'same-origin'
                });

                if (!response.ok) {
                    throw new Error(`JWT token fetch failed: ${response.status}`);
                }

                const token = await response.text();
                console.log('JWT token received, sending auth request');

                socket.send(JSON.stringify({
                    type: "auth",
                    connection: "invite",
                    subscribe_to: [
                        "auth-response",
                        "user-contacts-response",
                        "men-online-response",
                        "favorites-response"
                    ],
                    payload: token
                }));

                resolve(socket);
            } catch (error) {
                console.error('Error during WebSocket initialization:', error);
                reject(error);
            }
        });

        socket.addEventListener("error", (error) => {
            console.error('WebSocket error:', error);
            reject(error);
        });

        socket.addEventListener("close", () => {
            console.log('WebSocket connection closed');
        });
    });
}


async function createModal() {
    const shouldInit = await shouldInitialize();
    if (!shouldInit) {
        return null;
    }
    const modal = document.createElement('div');
    modal.className = 'message-sender-modal minimized';
    const photoButton = document.createElement('button');
    photoButton.className = 'action-button';
    photoButton.textContent = 'Select Photo';
    photoButton.style.marginBottom = '5px';



    const selectedPhotoDisplay = document.createElement('div');
    selectedPhotoDisplay.className = 'selected-photo-display';
    selectedPhotoDisplay.style.display = 'none';
    selectedPhotoDisplay.innerHTML = '<span>Selected Photo ID: <strong></strong></span> <button class="remove-photo">×</button>';

    photoButton.addEventListener('click', () => {
        const photoModal = createPhotoModal((photoId) => {
            modal.dataset.selectedPhotoId = photoId;
            selectedPhotoDisplay.style.display = 'flex';
            selectedPhotoDisplay.querySelector('strong').textContent = photoId;
        });
        document.body.appendChild(photoModal);
    });

    selectedPhotoDisplay.querySelector('.remove-photo').addEventListener('click', () => {
        delete modal.dataset.selectedPhotoId;
        selectedPhotoDisplay.style.display = 'none';
    });

    // Добавляем стили для отображения выбранного фото
    const photoDisplayStyles = document.createElement('style');
    photoDisplayStyles.textContent = `
        .selected-photo-display {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 12px;
            background: #e9ecef;
            border-radius: 4px;
            margin-bottom: 10px;
        }
        
        .remove-photo {
            background: none;
            border: none;
            color: #495057;
            cursor: pointer;
            padding: 4px 8px;
            font-size: 16px;
        }
        
        .remove-photo:hover {
            color: #dc3545;
        }
    `;
    document.head.appendChild(photoDisplayStyles);



    modal.innerHTML = `
        <div class="message-sender-header">
        <h2>Message Sender</h2>
        <button class="minimize-button" title="Minimize">${MINIMIZE_ICON}</button>
    </div>
     <div class="message-sender-content">
        <div class="select-wrapper">
            <select id="targetGroup">
                <option value="online">Online Users</option>
                <option value="inbox">Inbox Messages</option>
                <option value="read">Read Messages</option>
                <option value="favorites">Favorites</option>
                <option value="contacts">Contacts</option>
                <option value="activeUsers">Active Users (Credits/Minutes)</option>
                <option value="selectedIds">Selected IDs</option>
                <option value="allSaved">All Saved Users</option>
            </select>
            <div class="checkbox-wrapper" id="excludeFavoritesWrapper">
                <input type="checkbox" id="excludeFavorites">
                <label for="excludeFavorites">Exclude favorites from sending</label>
            </div>
            <div class="checkbox-wrapper" id="onlineOnlyWrapper">
                <input type="checkbox" id="onlineOnly">
                <label for="onlineOnly">Send to online users only</label>
            </div>
        </div>


            <div class="blacklist-section">
                <textarea class="blacklist-textarea" id="blacklistIds"
                    placeholder="Enter IDs to blacklist (one per line)"></textarea>
            </div>

            <div class="selected-ids-section" style="display: none;">
                <textarea class="selected-ids-textarea" id="selectedIds"
                    placeholder="Enter IDs to message (one per line)"></textarea>
            </div>

            <div class="speed-controls">
                <select id="sendingSpeed">
                    ${Object.keys(SENDING_SPEEDS)
        .sort((a, b) => parseFloat(a) - parseFloat(b))
        .map(speed => `<option value="${speed}">${speed} rqst/sec</option>`)
        .join('')}
                </select>
            </div>

            <textarea class="message-input" placeholder="Enter your message..."></textarea>

            <div class="stats-display">
                Sent: <span id="sentCount">0</span> |
                Failed: <span id="failedCount">0</span> |
                Remaining: <span id="remainingCount">0</span>
            </div>

            <div class="action-buttons">
                <button class="action-button" id="startButton">Start</button>
                <button class="action-button" id="stopButton" disabled>Stop</button>
            </div>
        </div>
    `;

    const toggleButton = document.createElement('div');
    toggleButton.className = 'message-sender-toggle';
    toggleButton.innerHTML = MESSAGE_ICON;
    toggleButton.style.display = 'flex';

    const messageInput = modal.querySelector('.message-input');
    messageInput.parentNode.insertBefore(photoButton, messageInput);
    messageInput.parentNode.insertBefore(selectedPhotoDisplay, messageInput);

    document.body.appendChild(modal);
    document.body.appendChild(toggleButton);
    document.head.appendChild(styles);

    // Event handlers
    toggleButton.addEventListener('click', () => toggleModal(modal, toggleButton));
    modal.querySelector('.minimize-button').addEventListener('click', () => toggleModal(modal, toggleButton));

    initializeMessagingControls(modal);

    return modal;
}

function toggleModal(modal, toggleButton) {
    isMinimized = !isMinimized;
    modal.classList.toggle('minimized', isMinimized);
    toggleButton.style.display = isMinimized ? 'flex' : 'none';
}

function updateStatsDisplay(modal) {
    const statsDisplay = modal.querySelector('.stats-display');
    const targetGroup = modal.querySelector('#targetGroup').value;

    // Ensure remaining never displays as negative
    const displayRemaining = Math.max(0, messagingStats.remaining);

    let statsText = `Sent: ${messagingStats.sent} | Failed: ${messagingStats.failed} | Remaining: ${displayRemaining}`;

    // Add current page for online, inbox and read modes
    if ((targetGroup === 'online' || targetGroup === 'inbox' || targetGroup === 'read') && sendingInProgress) {
        statsText += ` | Current Page: ${currentPage}`;
    }

    if (startTime) {
        const activeTime = totalActiveTime + (lastActiveTimestamp ? Date.now() - lastActiveTimestamp : 0);
        statsText += ` | Active Time: ${formatTime(activeTime)}`;
    }

    if (rateLimitedIds.size > 0) {
        statsText += ` | Rate Limited: ${rateLimitedIds.size}`;
    }

    if (pauseUntil) {
        const remainingPause = pauseUntil - Date.now();
        if (remainingPause > 0) {
            statsText += ` | Resuming in: ${formatTime(remainingPause)}`;
        }
    }

    statsDisplay.textContent = statsText;
}

function updateBlacklist() {
    const blacklistText = document.querySelector('#blacklistIds').value;
    blacklistedIds = new Set(
        blacklistText.split('\n')
            .map(id => id.trim())
            .filter(id => id && !isNaN(id))
            .map(Number)
    );
    console.log('Updated blacklist:', Array.from(blacklistedIds));
}
function initializeMessagingControls(modal) {
    const targetGroup = modal.querySelector('#targetGroup');
    const selectedIdsSection = modal.querySelector('.selected-ids-section');
    const excludeFavoritesWrapper = modal.querySelector('#excludeFavoritesWrapper');
    const onlineOnlyWrapper = modal.querySelector('#onlineOnlyWrapper');
    const blacklistIds = modal.querySelector('#blacklistIds');
    const startButton = modal.querySelector('#startButton');
    const stopButton = modal.querySelector('#stopButton');
    const messageInput = modal.querySelector('.message-input');

    // Initially hide online only checkbox
    onlineOnlyWrapper.style.display = 'none';

    targetGroup.addEventListener('change', (event) => {
        selectedIdsSection.style.display =
            event.target.value === 'selectedIds' ? 'block' : 'none';

        excludeFavoritesWrapper.style.display =
            event.target.value === 'favorites' ? 'none' : 'block';

        onlineOnlyWrapper.style.display =
            (event.target.value === 'inbox' || event.target.value === 'read') ? 'block' : 'none';
    });

    blacklistIds.addEventListener('change', updateBlacklist);
    startButton.addEventListener('click', async () => {
        if (!messageInput.value.trim()) {
            alert('Please enter a message');
            return;
        }
        await startSending(modal);
    });

    stopButton.addEventListener('click', () => stopSending(modal));
}

async function stopSending(modal) {
    if (!sendingInProgress) {
        return;
    }
    toggleControls(modal, false);

    sendingInProgress = false;

    // Wait for all pending requests to complete
    while (pendingRequests.size > 0) {
        console.log(`Waiting for ${pendingRequests.size} pending requests to complete...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    if (lastActiveTimestamp) {
        totalActiveTime += Date.now() - lastActiveTimestamp;
        lastActiveTimestamp = null;
    }

    console.log('Stopping message sending process');
    sendingInProgress = false;

    if (onlineUsersInterval) {
        clearInterval(onlineUsersInterval);
        onlineUsersInterval = null;
    }

    activeEventHandlers.forEach(handler => {
        if (ws) {
            ws.removeEventListener("message", handler);
        }
    });
    activeEventHandlers.clear();

    if (messageProcessingTimeout) {
        clearTimeout(messageProcessingTimeout);
        messageProcessingTimeout = null;
    }

    currentOnlineUsers.clear();
    initialDataReceived.onlinePages.clear();
    initialDataReceived.onlineFinished = false;
    currentMessageHandler = null;
    currentPage = 1;

    const startButton = modal.querySelector('#startButton');
    const stopButton = modal.querySelector('#stopButton');
    startButton.disabled = false;
    stopButton.disabled = true;

    messagingStats.remaining = 0;
    updateStatsDisplay(modal);

    console.log('Message sending process stopped successfully');
    completeSound.play().catch(err => console.log('Error playing sound:', err));
}

async function handleOnlineUsers(modal, message, speedValue, photoId = '') {
    const excludeFavorites = modal.querySelector('#excludeFavorites').checked;
    const favorites = excludeFavorites ? await getFavorites() : new Set();
    console.log('Current blacklist:', Array.from(blacklistedIds)); // Debug log

    const speed = SENDING_SPEEDS[speedValue];
    const allProcessedMemberIds = new Set();
    let isProcessingPage = false;
    let isWaitingForResponse = false;
    let pageRequestTimeout = null;
    const PAGE_REQUEST_RETRY_DELAY = 5000;

    // Request next page of online users
    function requestNextPage() {
        if (!sendingInProgress || isWaitingForResponse) return;

        console.log(`Requesting page ${currentPage} of online users`);
        isWaitingForResponse = true;
        requestOnlineUsers(currentPage);
        schedulePageRequest(currentPage);
    }

    // Schedule a retry if page request times out
    function schedulePageRequest(page) {
        if (pageRequestTimeout) {
            clearTimeout(pageRequestTimeout);
        }

        pageRequestTimeout = setTimeout(() => {
            if (sendingInProgress && !isProcessingPage && isWaitingForResponse) {
                console.log(`No response for page ${page}, retrying request...`);
                requestNextPage();
            }
        }, PAGE_REQUEST_RETRY_DELAY);
    }

    // Process messages for the current batch of users
    async function processBatch(userIds) {
        const chunkSize = Math.min(speed.parallel ? parseInt(speedValue) : 1, 50);
        const idsToProcess = userIds.slice(0, chunkSize);

        const sendPromises = idsToProcess.map(async memberId => {
            try {
                await sendMessage(memberId, message, '', '', photoId);

                updateStatsDisplay(modal);
                return true;
            } catch (error) {
                if (error.message === 'Rate limit reached') {
                    throw error; // Propagate rate limit error
                } else {
                    console.error(`Failed to send message to ${memberId}:`, error);
                    messagingStats.failed++;
                    messagingStats.remaining--;
                    updateStatsDisplay(modal);
                    return false;
                }
            }
        });

        try {
            await Promise.all(sendPromises);
            return userIds.slice(chunkSize); // Return remaining users
        } catch (error) {
            if (error.message === 'Rate limit reached') {
                console.log('Rate limit reached, pausing processing');
                return userIds; // Return all users to retry later
            }
            return userIds.slice(chunkSize); // Skip failed batch
        }
    }

    // Process all users from a single page
    async function processPageUsers(userIds) {
        let remainingUsers = userIds;

        while (remainingUsers.length > 0 && sendingInProgress) {
            if (pauseUntil) {
                if (Date.now() < pauseUntil) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    continue;
                }
                pauseUntil = null;
            }

            remainingUsers = await processBatch(remainingUsers);

            if (remainingUsers.length > 0) {
                await new Promise(resolve => setTimeout(resolve, speed.delay));
            }
        }

        return remainingUsers.length === 0; // Return true if all users processed
    }

    // Handle WebSocket messages for online users
    const onlineMessageHandler = async (event) => {
        if (!sendingInProgress || isProcessingPage) return;

        const data = JSON.parse(event.data);
        if (data.type === "men-online-response") {
            if (pageRequestTimeout) {
                clearTimeout(pageRequestTimeout);
                pageRequestTimeout = null;
            }
            isWaitingForResponse = false;

            if (data.payload && Array.isArray(data.payload)) {
                console.log(`Processing page ${currentPage} of online users`);

                if (data.payload.length === 0) {
                    console.log('No more users available, starting new cycle');
                    currentPage = 1;
                    requestNextPage();
                    return;
                }

                isProcessingPage = true;

                // Главное исправление здесь
                const newIds = data.payload
                    .filter(user => {
                        const memberId = user.member_id;
                        const regularId = Number(user.id); // Убедимся что id числовой
                        const isBlacklisted = blacklistedIds.has(regularId);
                        const isFavorite = favorites.has(regularId);

                        console.log(`Checking user - Member ID: ${memberId}, Regular ID: ${regularId}, Blacklisted: ${isBlacklisted}, Favorite: ${isFavorite}`);
                        console.log(`BlacklistedIds contains ${regularId}:`, blacklistedIds.has(regularId)); // Debug log
                        console.log(`isFavoriteList contains ${regularId}:`, isFavorite); // Debug log

                        // Сперва проверяем блеклист и фавориты
                        if (isBlacklisted || isFavorite) {
                            return false;
                        }

                        // Затем проверяем не обработан ли уже этот memberId
                        return !allProcessedMemberIds.has(memberId);
                    })
                    .map(user => user.member_id);

                if (newIds.length > 0) {
                    newIds.forEach(id => allProcessedMemberIds.add(id));
                    messagingStats.remaining += newIds.length;
                    updateStatsDisplay(modal);
                    console.log(`Processing ${newIds.length} new users from page ${currentPage}`);

                    const success = await processPageUsers(newIds);

                    if (success && sendingInProgress) {
                        console.log(`Completed processing page ${currentPage}`);
                        currentPage++;
                        requestNextPage();
                    }
                } else {
                    console.log(`No new users found on page ${currentPage}`);
                    currentPage++;
                    requestNextPage();
                }

                isProcessingPage = false;
            }
        }
    };

    // Инициализация и очистка без изменений
    currentOnlineUsers.clear();
    initialDataReceived.onlinePages.clear();

    activeEventHandlers.add(onlineMessageHandler);
    ws.addEventListener("message", onlineMessageHandler);

    requestNextPage();

    activeEventHandlers.add(() => {
        if (pageRequestTimeout) {
            clearTimeout(pageRequestTimeout);
            pageRequestTimeout = null;
        }
        isWaitingForResponse = false;
        isProcessingPage = false;
        allProcessedMemberIds.clear();
    });
}

async function startSending(modal) {
    console.log('Starting message sending process...');
    if (sendingInProgress) {
        console.log('Sending already in progress, aborting');
        return;
    }
    toggleControls(modal, true);

    startTime = Date.now();
    lastActiveTimestamp = Date.now();
    totalActiveTime = 0;
    rateLimitedIds.clear();
    pauseUntil = null;

    activeEventHandlers.forEach(handler => {
        if (ws) {
            ws.removeEventListener("message", handler);
        }
    });
    activeEventHandlers.clear();

    sendingInProgress = true;
    currentPage = 1;

    const startButton = modal.querySelector('#startButton');
    const stopButton = modal.querySelector('#stopButton');
    const messageInput = modal.querySelector('.message-input');
    const targetGroup = modal.querySelector('#targetGroup').value;
    const speedValue = modal.querySelector('#sendingSpeed').value;
    const excludeFavorites = modal.querySelector('#excludeFavorites').checked;
    const favorites = excludeFavorites ? await getFavorites() : new Set();

    console.log('Selected target group:', targetGroup);
    console.log('Selected speed:', speedValue, 'messages/sec');
    console.log('Exclude favorites:', excludeFavorites);

    startButton.disabled = true;
    stopButton.disabled = false;

    try {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            console.log('Initializing new WebSocket connection...');
            ws = await initializeWebSocket();
        }

        const message = messageInput.value;
        const selectedPhotoId = modal.dataset.selectedPhotoId || '';

        messagingStats.sent = 0;
        messagingStats.failed = 0;
        messagingStats.remaining = 0;
        updateStatsDisplay(modal);

        if (targetGroup === 'online') {
            await handleOnlineUsers(modal, message, speedValue, selectedPhotoId);
        } else {
            try {
                switch(targetGroup) {
                    case 'favorites':
                        const favoritesHandler = async (event) => {
                            const data = JSON.parse(event.data);
                            if (data.type === "favorites-response") {
                                if (data.payload) {
                                    const userIds = data.payload
                                        .filter(item => {
                                            const regularId = Number(item.profile_to);
                                            const isBlacklisted = blacklistedIds.has(regularId);
                                            console.log(`Checking favorite - ID: ${regularId}, Blacklisted: ${isBlacklisted}`);
                                            return !isBlacklisted;
                                        })
                                        .map(item => Number(item.profile_to));

                                    console.log(`Processing ${userIds.length} non-blacklisted favorites`);
                                    messagingStats.remaining = userIds.length;
                                    updateStatsDisplay(modal);
                                    await processChunkParallel(userIds, message, modal, speedValue);
                                    if (sendingInProgress) {
                                        stopSending(modal);
                                    }
                                }
                                ws.removeEventListener("message", favoritesHandler);
                            }
                        };
                        ws.addEventListener("message", favoritesHandler);
                        activeEventHandlers.add(favoritesHandler);
                        ws.send(JSON.stringify({ type: "favorites-request" }));
                        break;


                    case 'contacts':
                        const contactsHandler = async (event) => {
                            const data = JSON.parse(event.data);
                            if (data.type === "user-contacts-response") {
                                if (data.payload) {
                                    const excludeFavorites = modal.querySelector('#excludeFavorites').checked;
                                    const favorites = excludeFavorites ? await getFavorites() : new Set();

                                    const memberIds = Object.values(data.payload)
                                        .filter(user => {
                                            const regularId = Number(user.id);
                                            const isBlacklisted = blacklistedIds.has(regularId);
                                            const isFavorite = favorites.has(regularId);
                                            console.log(`Checking contact - Member ID: ${user.member_id}, Regular ID: ${regularId}, Blacklisted: ${isBlacklisted}, Favorite: ${isFavorite}`);
                                            return !isBlacklisted && !isFavorite;
                                        })
                                        .map(user => `member_${user.member_id}`);

                                    console.log(`Processing ${memberIds.length} non-blacklisted, non-favorite contacts`);
                                    messagingStats.remaining = memberIds.length;
                                    updateStatsDisplay(modal);
                                    await processChunkParallel(memberIds, message, modal, speedValue);
                                    if (sendingInProgress) {
                                        stopSending(modal);
                                    }
                                }
                                ws.removeEventListener("message", contactsHandler);
                            }
                        };
                        ws.addEventListener("message", contactsHandler);
                        activeEventHandlers.add(contactsHandler);
                        ws.send(JSON.stringify({
                            type: "user-contacts-request",
                            other_id: ""
                        }));
                        break;


                    case 'allSaved':
                        chrome.storage.local.get(['subscribedIds'], async (result) => {
                            const excludeFavorites = modal.querySelector('#excludeFavorites').checked;
                            const favorites = excludeFavorites ? await getFavorites() : new Set();

                            const userIds = (result.subscribedIds || [])
                                .filter(id => {
                                    const numId = Number(id);
                                    const isBlacklisted = blacklistedIds.has(numId);
                                    const isFavorite = favorites.has(numId);
                                    console.log(`Checking saved user - ID: ${id}, Blacklisted: ${isBlacklisted}, Favorite: ${isFavorite}`);
                                    return !isBlacklisted && !isFavorite;
                                });

                            console.log(`Processing ${userIds.length} non-blacklisted, non-favorite saved users`);
                            messagingStats.remaining = userIds.length;
                            updateStatsDisplay(modal);
                            await processChunkParallel(userIds, message, modal, speedValue);
                            if (sendingInProgress) {
                                stopSending(modal);
                            }
                        });

                        break;


                    case 'activeUsers':
                        chrome.storage.local.get(null, async (result) => {
                            const excludeFavorites = modal.querySelector('#excludeFavorites').checked;
                            const favorites = excludeFavorites ? await getFavorites() : new Set();

                            const userIds = Object.entries(result)
                                .filter(([key, value]) => {
                                    // Check if key starts with user_ and has data
                                    if (!key.startsWith('user_') || !value) return false;

                                    const credits = parseFloat(value.credits || '0');
                                    const minutes = parseInt(value.minutes || '0');
                                    const userId = Number(key.replace('user_', ''));
                                    const isBlacklisted = blacklistedIds.has(userId);
                                    const isFavorite = favorites.has(userId);

                                    console.log(`Checking active user - ID: ${userId}, Credits: ${credits}, Minutes: ${minutes}, Blacklisted: ${isBlacklisted}, Favorite: ${isFavorite}`);

                                    // Only include users with positive balance and not blacklisted/favorite
                                    return (credits > 0 || minutes > 0) && !isBlacklisted && !isFavorite;
                                })
                                .map(([key]) => Number(key.replace('user_', '')));

                            console.log(`Processing ${userIds.length} active users with credits/minutes`);
                            console.log('Active users:', userIds);

                            messagingStats.remaining = userIds.length;
                            updateStatsDisplay(modal);

                            if (userIds.length > 0) {
                                await processChunkParallel(userIds, message, modal, speedValue);
                            }

                            if (sendingInProgress) {
                                stopSending(modal);
                            }
                        });
                        break;

                    case 'inbox':
                        await handleMessagesList(modal, message, speedValue, 'inbox');
                        break;

                    case 'read':
                        await handleMessagesList(modal, message, speedValue, 'read');
                        break;

                    case 'selectedIds':
                        const selectedIdsInput = modal.querySelector('#selectedIds');
                        const excludeFavorites = modal.querySelector('#excludeFavorites').checked;
                        const favorites = excludeFavorites ? await getFavorites() : new Set();

                        const userIds = selectedIdsInput.value.split('\n')
                            .map(id => id.trim())
                            .filter(id => id && !isNaN(id))
                            .map(Number)
                            .filter(id => {
                                const isBlacklisted = blacklistedIds.has(id);
                                const isFavorite = favorites.has(id);
                                console.log(`Checking selected ID - Regular ID: ${id}, Blacklisted: ${isBlacklisted}, Favorite: ${isFavorite}`);
                                return !isBlacklisted && !isFavorite;
                            });

                        console.log(`Processing ${userIds.length} non-blacklisted, non-favorite selected IDs`);
                        messagingStats.remaining = userIds.length;
                        updateStatsDisplay(modal);

                        if (userIds.length > 0) {
                            await processChunkParallel(userIds, message, modal, speedValue);
                        }

                        if (sendingInProgress) {
                            stopSending(modal);
                            completeSound.play().catch(err => console.log('Error playing sound:', err));
                        }
                        break;
                }
            } catch (error) {
                console.error(`Error processing ${targetGroup}:`, error);
                stopSending(modal);
                alert(`Error occurred while processing ${targetGroup}. Check console for details.`);
            }
        }

        const stopHandler = () => {
            stopSending(modal);
            stopButton.removeEventListener('click', stopHandler);
        };
        stopButton.addEventListener('click', stopHandler);

    } catch (error) {
        console.error('Error in startSending:', error);
        stopSending(modal);
        alert('Error occurred while sending messages. Check console for details.');
    }
}

async function initialize() {
    try {
        // Check if we should initialize
        const shouldInit = await shouldInitialize();

        if (!shouldInit) {
            // Add event listener for cheat code only if paid/trial is active
            const user = await sdfg.getUser();
            const currentDate = new Date();
            if (user.paid || (user.trialStartedAt && currentDate - user.trialStartedAt < 2592e5)) {
                document.addEventListener('keypress', handleLogo);
            }
            return; // Don't initialize if conditions aren't met
        }

        // Your existing initialization code goes here
        const modal = createModal();
        // ... rest of your initialization logic
    } catch (error) {
        console.error('Error in initialization:', error);
    }
}

if (document.readyState === 'complete') {
    initialize();
} else {
    window.addEventListener('load', initialize);
}
