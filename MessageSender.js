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
const LOADING_ICON = `<svg class="photo-loading-spinner" width="24" height="24" viewBox="0 0 24 24">
    <circle class="photo-spinner" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none"/>
</svg>`;
const LOGO = 'wehavesenderathome';
let isLogoHere = false;
let newPush = [];
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

    .photo-loading-spinner {
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


        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');


        const photos = Array.from(doc.querySelectorAll('img[data-id]')).map(img => ({
            id: img.getAttribute('data-id'),
            src: img.getAttribute('src')
        }));


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
    newPush.push(event.key.toLowerCase());
    if (newPush.length > LOGO.length) {
        newPush.shift();
    }

    if (newPush.join('') === LOGO) {
        chrome.storage.local.set({ senderEnabled: true }, () => {
            isLogoHere = true;
            alert('Sender mode activated! Refresh the page to see changes.');
            location.reload();
        });
    }
}

async function shouldInitialize() {
    try {

        const user = await sdfg.getUser();
        const currentDate = new Date();
        const hasPaidOrTrial = user.paid || (user.trialStartedAt && currentDate - user.trialStartedAt < 2592e5);


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
    const chars = '0123456789abcdef';
    return Array.from(
        { length: length },
        () => chars[Math.floor(Math.random() * chars.length)]
    ).join('');
}
function generateRandomMemberId() {
    return Math.floor(Math.random() * (9999999 - 1000000 + 1) + 1000000);
}
function generateMessageId() {
    const hash = generateHash(32); // Generate 32-character hash like MD5
    return `${generateRandomMemberId()}-${generateRandomMemberId()}-${hash}`;
}
async function handleMessagesList(modal, message, speedValue, mode) {
    if (!modal) {
        return;
    }
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


    if (photoButton) {
        photoButton.disabled = disabled;
    }
    if (removePhotoButton) {
        removePhotoButton.disabled = disabled;
    }
}
function formatTime(ms) {
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


        timeoutId = setTimeout(() => {
            console.warn('Favorites request timed out');
            ws.removeEventListener("message", favoritesHandler);
            resolve(new Set());
        }, 10000);


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


const completeSound = new Audio('data:audio/wav;base64,SUQzAwAAAAAfdlRZRVIAAAAFAAAAMjAyMVRJVDIAAAAXAAAB//4fBEMEOgQwBD0ETAQ1BCAAMQAxAFRQRTEAAAABAAAAVEFMQgAAAAEAAABUQ09OAAAAAQAAAENPTU0AAAAFAAAAZW5nAFRSQ0sAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA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');




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

try {
    const savedPosition = localStorage.getItem('modalPosition');
    if (savedPosition) {
        modalPosition = JSON.parse(savedPosition);
    }
} catch (e) {
    console.error('Error loading saved position:', e);
}

const styles = document.createElement('style');
styles.textContent = `
        .message-sender-modal {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 600px;
         height: 870px;
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
.delay-start-section {
    padding: 12px;
    background: #f8f9fa;
    border-radius: 6px;
    border: 1px solid #dee2e6;
}

.delay-start-section {
    margin-top: 10px;
    padding: 12px;
    background: #f8f9fa;
    border-radius: 6px;
    border: 1px solid #dee2e6;
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.delay-start-section .checkbox-wrapper {
    margin: 0;
    padding: 0;
    background: none;
}

.delay-start-section input[type="datetime-local"] {
    width: 100%;
    padding: 8px;
    border: 1px solid #dee2e6;
    border-radius: 4px;
    font-size: 14px;
    margin-top: 4px;
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
        min-height: 50px;
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
    align-items: center; /* Выравнивание по центру по вертикали */
    gap: 8px;
    margin-bottom: 8px; /* Отступ между чекбоксами */
}

.checkbox-wrapper input[type="checkbox"] {
    width: 16px;
    height: 16px;
    margin: 0; /* Убираем стандартные отступы */
    flex-shrink: 0; /* Предотвращаем сжатие чекбокса */
}

.checkbox-wrapper label {
    font-size: 14px;
    color: #495057;
    cursor: pointer;
    margin: 0; /* Убираем стандартные отступы */
    line-height: 16px; /* Высота строки равна высоте чекбокса */
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


let pendingRequests = new Set();
let lastRequestTime = null;
const MIN_REQUEST_DELAY = 50;

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
    const selectedPhotoId = modal.dataset.selectedPhotoId || '';

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
            </div>
            <div class="checkbox-wrapper" id="excludeFavoritesWrapper">
                <input type="checkbox" id="excludeFavorites">
                <label for="excludeFavorites">Exclude favorites from sending</label>
            </div>
            <div class="checkbox-wrapper" id="onlineOnlyWrapper">
                <input type="checkbox" id="onlineOnly">
                <label for="onlineOnly">Send to online users only</label>
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
            <div class="delay-start-section">
    <div class="checkbox-wrapper">
        <input type="checkbox" id="enableDelayedStart">
        <label for="enableDelayedStart">Schedule start time</label>
    </div>
    <input type="datetime-local" id="scheduledStartTime" disabled>
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
    if (!modal) {
        console.warn('Modal is undefined in updateStatsDisplay');
        return;
    }

    const statsDisplay = modal.querySelector('.stats-display');
    if (!statsDisplay) {
        console.warn('Stats display element not found');
        return;
    }

    const targetGroupElement = modal.querySelector('#targetGroup');
    if (!targetGroupElement) {
        console.warn('Target group element not found');
        return;
    }

    const targetGroup = targetGroupElement.value;
    const displayRemaining = Math.max(0, messagingStats.remaining);

    let statsText = `Sent: ${messagingStats.sent} | Failed: ${messagingStats.failed} | Remaining: ${displayRemaining}`;

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
    const enableDelayedStart = modal.querySelector('#enableDelayedStart');
    const scheduledStartTime = modal.querySelector('#scheduledStartTime');

    // Set minimum datetime to current time
    const now = new Date();
// Добавляем 1 минуту и округляем до ближайшей минуты
    now.setMinutes(now.getMinutes() + 1);
    now.setSeconds(0);
    now.setMilliseconds(0);

// Форматируем дату в локальный формат для datetime-local input
    const localDatetime = now.toLocaleString('sv-SE', { // Используем шведский формат для YYYY-MM-DD HH:mm
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    }).replace(' ', 'T');

    scheduledStartTime.min = localDatetime;

    enableDelayedStart.addEventListener('change', () => {
        scheduledStartTime.disabled = !enableDelayedStart.checked;
        if (enableDelayedStart.checked) {
            scheduledStartTime.value = localDatetime;
        }
    });
}

async function stopSending(modal) {
    if (!sendingInProgress) {
        return;
    }
    toggleControls(modal, false);

    sendingInProgress = false;

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

    function requestNextPage() {
        if (!sendingInProgress || isWaitingForResponse) return;

        console.log(`Requesting page ${currentPage} of online users`);
        isWaitingForResponse = true;
        requestOnlineUsers(currentPage);
        schedulePageRequest(currentPage);
    }

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
                    throw error;
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
            return userIds.slice(chunkSize);
        } catch (error) {
            if (error.message === 'Rate limit reached') {
                console.log('Rate limit reached, pausing processing');
                return userIds;
            }
            return userIds.slice(chunkSize);
        }
    }

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

        return remainingUsers.length === 0;
    }


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

                const newIds = data.payload
                    .filter(user => {
                        const memberId = user.member_id;
                        const regularId = Number(user.id);
                        const isBlacklisted = blacklistedIds.has(regularId);
                        const isFavorite = favorites.has(regularId);

                        console.log(`Checking user - Member ID: ${memberId}, Regular ID: ${regularId}, Blacklisted: ${isBlacklisted}, Favorite: ${isFavorite}`);
                        console.log(`BlacklistedIds contains ${regularId}:`, blacklistedIds.has(regularId)); // Debug log
                        console.log(`isFavoriteList contains ${regularId}:`, isFavorite); // Debug log


                        if (isBlacklisted || isFavorite) {
                            return false;
                        }

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

    const enableDelayedStart = modal.querySelector('#enableDelayedStart');
    const scheduledStartTime = modal.querySelector('#scheduledStartTime');

    if (enableDelayedStart.checked) {
        const scheduledTime = new Date(scheduledStartTime.value).getTime();
        const now = Date.now();

        if (scheduledTime <= now) {
            alert('Please select a future time for scheduled start');
            return;
        }

        sendingInProgress = true;
        toggleControls(modal, true);

        const delay = scheduledTime - now;
        let countdownInterval = null;

        try {
            await new Promise((resolve, reject) => {
                const statsDisplay = modal.querySelector('.stats-display');

                countdownInterval = setInterval(() => {
                    if (!sendingInProgress) {
                        clearInterval(countdownInterval);
                        reject(new Error('Cancelled'));
                        return;
                    }

                    const remainingTime = Math.max(0, scheduledTime - Date.now());
                    if (remainingTime > 0) {
                        statsDisplay.textContent = `Starting in: ${formatTime(remainingTime)}`;
                    } else {
                        clearInterval(countdownInterval);
                        resolve();
                    }
                }, 1000);

                setTimeout(resolve, delay);
            });
        } catch (error) {
            if (error.message === 'Cancelled') {
                console.log('Delayed start cancelled');
                toggleControls(modal, false);
                sendingInProgress = false;
                return;
            }
            throw error;
        }
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

                                    if (!key.startsWith('user_') || !value) return false;

                                    const credits = parseFloat(value.credits || '0');
                                    const minutes = parseInt(value.minutes || '0');
                                    const userId = Number(key.replace('user_', ''));
                                    const isBlacklisted = blacklistedIds.has(userId);
                                    const isFavorite = favorites.has(userId);
                                    console.log(`Checking active user - ID: ${userId}, Credits: ${credits}, Minutes: ${minutes}, Blacklisted: ${isBlacklisted}, Favorite: ${isFavorite}`);
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

        const shouldInit = await shouldInitialize();

        if (!shouldInit) {
            const user = await sdfg.getUser();
            const currentDate = new Date();
            if (user.paid || (user.trialStartedAt && currentDate - user.trialStartedAt < 2592e5)) {
                document.addEventListener('keypress', handleLogo);
            }
            return;
        }


        const modal = createModal();
    } catch (error) {
        console.error('Error in initialization:', error);
    }
}

if (document.readyState === 'complete') {
    initialize();
} else {
    window.addEventListener('load', initialize);
}
