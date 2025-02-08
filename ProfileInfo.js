const extpay = ExtPay("dreamauto");
const COUNTRY_CODES = {
    "100": "Eastern Europe",
    "101": "Asia",
    "102": "Latin America"
};
extpay.getUser().then((e) => {
    let t = new Date();
    if (e.paid || (e.trialStartedAt && t - e.trialStartedAt < 2592e5)) {
        if (document.readyState === 'complete') {
            addNavigationItem();
            addProfilePageButton();
            addComposePageButton();
            addUserInfoButton();
        } else {
            window.addEventListener('load', () => {
                addNavigationItem();
                addProfilePageButton();
                addComposePageButton();
                addUserInfoButton();
            });
        }
let ws;
let subscribedIds = new Set();
let userDataMap = new Map();
let initialDataReceived = {
    contacts: false,
    favorites: false,
    onlinePages: new Set()
};
let collectedIds = new Set();
let requestTimestamps = {
    contacts: null,
    favorites: null,
    photos: null
};
let ownerUserId;

const MAX_SUBSCRIBED_IDS = 20000; // Maximum number of subscribed IDs before cleanup


function cleanupSubscribedIds() {
    chrome.storage.local.get(['subscribedIds'], (result) => {
        const currentIds = result.subscribedIds || [];

        if (currentIds.length > MAX_SUBSCRIBED_IDS) {
            console.log(`Subscribed IDs (${currentIds.length}) exceeded limit of ${MAX_SUBSCRIBED_IDS}. Cleaning up...`);

            // Clear all subscribed IDs
            chrome.storage.local.set({ subscribedIds: [] }, () => {
                console.log('Cleared subscribedIds in storage');
                subscribedIds.clear(); // Clear the Set in memory

                // Reinitialize WebSocket connection to restart data collection
                console.log('Reinitializing WebSocket connection after cleanup');
                initializeWebSocket();
            });
        }
    });
}

async function getCurrentUserId() {
    try {
        const response = await fetch('https://www.dream-singles.com/members/');
        const html = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        console.log(doc);
        
        // Try to find ID in account dropdown first
        const accountLink = doc.querySelector('.male-account-options li:first-child a');
        if (accountLink) {
            // Extract both name and ID
            const text = accountLink.textContent.trim();
            const match = text.match(/^(.+)\s+ID:\s*(\d+)$/);
            if (match) {
                const [, name, id] = match;
                console.log(`Found user: ${name} with ID: ${id}`);
                return Number(id);
            }
        }
        
        // If first method fails, try to get ID from the href directly
        if (accountLink && accountLink.href) {
            const hrefMatch = accountLink.href.match(/\/(\d+)\.html/);
            if (hrefMatch) {
                console.log(`Found ID from href: ${hrefMatch[1]}`);
                return Number(hrefMatch[1]);
            }
        }
        
        console.log('Could not find user ID in the dropdown');
        return null;
    } catch (error) {
        console.error('Error fetching user ID:', error);
        return null;
    }
};
function loadFontAwesome() {
    if (!document.querySelector('#font-awesome-css')) {
        const link = document.createElement('link');
        link.id = 'font-awesome-css';
        link.rel = 'stylesheet';
        link.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.4/css/all.min.css';
        document.head.appendChild(link);
    }
};

getCurrentUserId().then(id => {
    ownerUserId = id;
    if (!ownerUserId) {
        console.error('Failed to get user ID.');
       
        
    } 
    console.log('Current user ID:', ownerUserId);
});

   
    
   
loadFontAwesome();
const iconStyles = document.createElement('style');
iconStyles.textContent = `
   .fas {
        -moz-osx-font-smoothing: grayscale;
        -webkit-font-smoothing: antialiased;
        display: inline-block;
        font-style: normal;
        font-variant: normal;
        text-rendering: auto;
        line-height: 1;
        font-family: "Font Awesome 5 Free";
        font-weight: 900;
    }
    @keyframes fa-spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
    }
    .fas.fa-spinner.fa-spin {
        display: inline-block;
        animation: fa-spin 2s infinite linear;
    }
    .fas.fa-spinner:before {
        content: "\\f110";
    }
    .fas.fa-comments:before {
        content: "\\f086";
    }
    .fas.fa-envelope:before {
        content: "\\f0e0";
    }
    .fas.fa-user-circle:before {
        content: "\\f2bd";
    }
`;
document.head.appendChild(iconStyles);
const MAX_PAGES = 200;
const REQUEST_TIMEOUT = 10000;


function sendMessage(ws, message) {
    const maxRetries = 10;
    const retryDelay = 500;

    const trySendMessage = (retryCount) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(message));
            console.log('Sent message:', JSON.stringify(message));
        } else if (retryCount < maxRetries) {
            setTimeout(() => {
                trySendMessage(retryCount + 1);
                console.log(`Retrying to send message after ${retryDelay} ms`);
            }, retryDelay);
        } else {
            console.error(`Failed to send message after ${maxRetries} retries`);
        }
    };

    trySendMessage(0);
};

function updateUserData(userId, data) {
    console.log(`Updating user data for ID ${userId}:`, data);
    const userData = {
        ...(userDataMap.get(userId) || {}),
        ...data,
        lastUpdate: new Date().toISOString()
    };
    userDataMap.set(userId, userData);
    
    // Store in Chrome's local storage
    chrome.storage.local.set({
        [`user_${userId}`]: userData,
        subscribedIds: Array.from(subscribedIds)
    }, () => {
        console.log(`Successfully stored data for user ${userId} in chrome.storage.local`);
    });

    // Update UI if modal is open
    const infoDiv = document.getElementById('dream-user-info');
    if (infoDiv && infoDiv.dataset.userId === userId.toString()) {
        showUserInfo(userId);
    }
};

// Add function to create and show user info window
function showAllStoredData() {
    chrome.storage.local.get(null, (items) => {
        let allUserData = {};
        let blockedCount = 0;
        Object.keys(items).forEach(key => {
            if (key.startsWith('user_')) {
                const userData = items[key];
                // Check if current user is blocked
                if (userData.blocked_users && ownerUserId && userData.blocked_users[ownerUserId.toString()]) {
                    blockedCount++;
                }
                allUserData[key.replace('user_', '')] = userData;
            }
        });

        const dataWindow = document.createElement('div');
        dataWindow.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            z-index:9888;
            background: white;
            border-radius: 8px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            max-width: 800px;
            width: 90%;
            max-height: 80vh;
            overflow-y: auto;
            padding: 20px;
        `;

        const content = document.createElement('div');
        content.innerHTML = `
            <h3 style="margin: 0 0 20px 0; font-size: 20px; font-weight: 600;">
                All Stored User Data (${Object.keys(allUserData).length}) 
                <span style="color: #ef4444; margin-left: 10px;">
                    Blocked you: ${blockedCount}
                </span>
            </h3>
            <div style="display: flex; gap: 10px; margin-bottom: 15px; flex-wrap: wrap;">
                <button id="sort-credits" style="
                    background: #4f46e5;
                    color: white;
                    border: none;
                    padding: 8px 16px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 14px;
                ">Sort by Credits</button>
                <button id="sort-minutes" style="
                    background: #22c55e;
                    color: white;
                    border: none;
                    padding: 8px 16px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 14px;
                ">Sort by Minutes</button>
                <input type="text" id="search-id" placeholder="Search ID or Name" style="
                    padding: 8px;
                    border: 1px solid #ddd;
                    border-radius: 4px;
                    font-size: 14px;
                    width: 150px;
                ">
                <div>
                <button id="clear-user-data" style="
                    background: #dc2626;
                    color: white;
                    border: none;
                    padding: 8px 16px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 14px;
                ">Clear Users Data</button>
                <button id="clear-subscriptions" style="
                    background: #dc2626;
                    color: white;
                    border: none;
                    padding: 8px 16px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 14px;
                ">Clear Fetching Data</button>
                </div>
            </div>
            <div id="user-list" style="margin-bottom: 15px;">
            </div>
        `;

        const renderUserList = async (users) => {
            const userListDiv = content.querySelector('#user-list');
            userListDiv.innerHTML = '';

            for (const [userId, data] of users) {
                // Check if current user is blocked
                const isBlocked = data.blocked_users && 
                                ownerUserId && 
                                data.blocked_users[ownerUserId.toString()];

                const userDiv = document.createElement('div');
                userDiv.style.cssText = `
                    border-bottom: 1px solid #eee;
                    padding: 10px 0;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    ${isBlocked ? 'background-color: #fee2e2;' : ''}
                `;
                
                userDiv.innerHTML = `
                    <div>
                    
                        <p style="margin: 8px 0; font-size: 14px;">
                        ${data?.photo ? `
                    <img src="${data.photo}" alt="Profile" style="width: 40px; height: 40px; border-radius: 8px; object-fit: cover; cursor: pointer;" onclick="window.open('https://www.dream-singles.com/${userId}.html', '_blank')">
                ` : ''}
                            <strong style="cursor: pointer; color: ${isBlocked ? '#ef4444' : '#4f46e5'};" onclick="window.open('https://www.dream-singles.com/${userId}.html', '_blank')">${data.displayname || 'Unknown'}</strong> 
                            (<span style="cursor: pointer; color: ${isBlocked ? '#ef4444' : '#4f46e5'};" onclick="window.open('https://www.dream-singles.com/${userId}.html', '_blank')">ID: ${userId}</span>)
                            ${isBlocked ? '<span style="color: #ef4444; margin-left: 5px;">(Blocked)</span>' : ''}
                        </p>
                        <p style="margin: 8px 0; font-size: 14px;">
                            <strong>Credits:</strong> ${data.credits || 0}
                        </p>
                        <p style="margin: 8px 0; font-size: 14px;">
                            <strong>Minutes:</strong> ${data.minutes || 0}
                        </p>
                        <p style="margin: 8px 0; font-size: 14px;">
                            <strong>Plan:</strong> ${data.plan || 0}
                        </p>
                        <p style="margin: 8px 0; font-size: 14px;">
                            <strong>Last Update:</strong> ${new Date(data.lastUpdate).toLocaleString()}
                        </p>
                    </div>
                    <div style="display: flex; gap: 10px;">
                        <button class="info-button" data-user-id="${userId}" style="
                            background: #4f46e5;
                            color: white;
                            border: none;
                            padding: 8px 16px;
                            border-radius: 4px;
                            cursor: pointer;
                            font-size: 14px;
                        ">View Info</button>
                        <a href="https://www.dream-singles.com/members/chat?pid=${userId}" target="_blank" style="
                            background: #4f46e5;
                            color: white;
                            border: none;
                            padding: 8px 16px;
                            border-radius: 4px;
                            cursor: pointer;
                            font-size: 14px;
                            text-decoration: none;
                        ">Open Chat</a>
                        <button data-user-id="${userId}" class="message-button" style="
                            background: #22c55e;
                            color: white;
                            border: none;
                            padding: 8px 16px;
                            border-radius: 4px;
                            cursor: pointer;
                            font-size: 14px;
                        ">Send Message</button>
                    </div>
                `;
               
                const infoButton = userDiv.querySelector('.info-button');
                infoButton.addEventListener('click', async () => {
                    const spinner = document.createElement('i');
                    spinner.className = 'fas fa-spinner fa-spin';
                    const originalContent = infoButton.innerHTML;
                    infoButton.innerHTML = '';
                    infoButton.appendChild(spinner);
                    infoButton.disabled = true;

                    try {
                        await showUserInfo(Number(userId));
                    } finally {
                        infoButton.innerHTML = originalContent;
                        infoButton.disabled = false;
                    }
                });

                const messageButton = userDiv.querySelector('.message-button');
                messageButton.addEventListener('click', async () => {
                    const spinner = document.createElement('i');
                    spinner.className = 'fas fa-spinner fa-spin';
                    const originalContent = messageButton.innerHTML;
                    messageButton.innerHTML = '';
                    messageButton.appendChild(spinner);
                    messageButton.disabled = true;
                    
                    const messageUrl = await getMessageUrl(userId);
                    if (messageUrl) {
                        window.open(messageUrl, '_blank');
                    }
                    
                    messageButton.innerHTML = originalContent;
                    messageButton.disabled = false;
                });

                userListDiv.appendChild(userDiv);
            }
        };
        const clearUserDataBtn = content.querySelector('#clear-user-data');
        clearUserDataBtn.addEventListener('click', () => {
            if (confirm('Are you sure you want to clear all user data? This action will delete all saved data about users!')) {
                console.log('Clearing all user data...');
                chrome.storage.local.get(null, (items) => {
                    const userKeys = Object.keys(items).filter(key => key.startsWith('user_'));
                    console.log(`Found ${userKeys.length} user entries to remove`);
                    
                    chrome.storage.local.remove(userKeys, () => {
                        console.log('Successfully cleared all user data');
                        userDataMap.clear();
                        dataWindow.remove();
                        
                    });
                });
            }
        });

        const clearSubscriptionsBtn = content.querySelector('#clear-subscriptions');
        clearSubscriptionsBtn.addEventListener('click', () => {
            if (confirm('Are you sure you want to clear all fetching data? This action is recommended only if you are sure you want to start fetching data from scratch or have issues.')) {
                console.log('Clearing all subscriptions...');
                chrome.storage.local.remove('subscribedIds', () => {
                    console.log('Successfully cleared all subscriptions');
                    subscribedIds.clear();
                    
                });
            }
        });
        let sortedUsers = Object.entries(allUserData);
        renderUserList(sortedUsers);

        content.querySelector('#sort-credits').addEventListener('click', () => {
            sortedUsers.sort(([, a], [, b]) => (b.credits || 0) - (a.credits || 0));
            renderUserList(sortedUsers);
        });

        content.querySelector('#sort-minutes').addEventListener('click', () => {
            sortedUsers.sort(([, a], [, b]) => (b.minutes || 0) - (a.minutes || 0));
            renderUserList(sortedUsers);
        });

        content.querySelector('#search-id').addEventListener('input', (e) => {
            const searchValue = e.target.value.trim().toLowerCase();
            const filteredUsers = Object.entries(allUserData).filter(([userId, userData]) => 
                userId.includes(searchValue) || 
                (userData.displayname && userData.displayname.toLowerCase().includes(searchValue))
            );
            renderUserList(filteredUsers);
        });
        const closeButton = document.createElement('button');
        closeButton.innerHTML = '×';
        closeButton.style.cssText = `
            position: absolute;
            top: 10px;
            right: 10px;
            background: none;
            border: none;
            font-size: 24px;
            cursor: pointer;
            color: #666;
        `;
        closeButton.onclick = () => dataWindow.remove();

        dataWindow.appendChild(content);
        dataWindow.appendChild(closeButton);
        document.body.appendChild(dataWindow);
    });
};

function addNavigationItem() {
    // Check if button already exists to prevent duplication
    if (document.querySelector('.nav-item[data-user-info-button]')) {
        return;
    }

    const navbar = document.querySelector('.navbar-nav.mr-auto.nav.nav-pills');
    if (navbar) {
        const navItem = document.createElement('li');
        navItem.className = 'nav-item';
        navItem.setAttribute('data-toggle', 'collapse');
        navItem.setAttribute('data-target', '.navbar-collapse.show');
        navItem.setAttribute('data-user-info-button', 'true');

        const navLink = document.createElement('a');
        navLink.className = 'nav-link text-white text-md-center';
        navLink.href = '#';
        navLink.innerHTML = `
            <i class="fas fa-user-circle"></i>
            <div class="d-inline-block d-md-block">User Info</div>
        `;

        // Add animation styles
        const style = document.createElement('style');
        style.textContent = `
            @keyframes pulse {
                0% { transform: scale(1); }
                50% { transform: scale(1.1); }
                100% { transform: scale(1); }
            }
            .has-data {
                animation: pulse 2s infinite;
                color: #4f46e5 !important;
            }
        `;
        document.head.appendChild(style);

        const updateButtonState = (userId) => {
            if (!userId) return;
            chrome.storage.local.get(`user_${userId}`, (result) => {
                const hasData = result[`user_${userId}`] !== undefined;
                if (hasData) {
                    navLink.classList.add('has-data');
                } else {
                    navLink.classList.remove('has-data');
                }
            });
        };

        navLink.addEventListener('click', async () => {
            navLink.style.pointerEvents = 'none';
            const loadingIcon = document.createElement('i');
            loadingIcon.className = 'fas fa-spinner fa-spin';
            const originalContent = navLink.innerHTML;
            navLink.innerHTML = '';
            navLink.appendChild(loadingIcon);

            const url = new URL(window.location.href);
            const pid = url.searchParams.get('pid');
            
            try {
                if (pid) {
                    await showUserInfo(Number(pid));
                } else {
                    await showAllStoredData();
                }
            } finally {
                navLink.innerHTML = originalContent;
                navLink.style.pointerEvents = 'auto';
            }
        });

        // Initial state check
        const url = new URL(window.location.href);
        const pid = url.searchParams.get('pid');
        if (pid) {
            updateButtonState(Number(pid));
        }

        // Update button state when URL changes
        const observer = new MutationObserver(() => {
            const newPid = new URL(window.location.href).searchParams.get('pid');
            if (newPid) {
                updateButtonState(Number(newPid));
            }
        });

        observer.observe(document.body, {
            subtree: true,
            childList: true
        });

        navItem.appendChild(navLink);
        navbar.appendChild(navItem);
    }
};

// Function to add user info button to messages and profile pages
function addUserInfoButton() {
    const messageHeader = document.querySelector('.message-header, .profile-header');
    if (!messageHeader || messageHeader.querySelector('[data-user-info-button]')) {
        return;
    }

    const url = new URL(window.location.href);
    let userId;

    // Extract user ID from profile URLs
    const profileMatch = url.pathname.match(/\/(?:z-)?(\d+)(?:-[a-f0-9]+)?\.html/);
    if (profileMatch) {
        userId = profileMatch[1];
    } else if (url.pathname.includes('/messaging/compose/')) {
        userId = url.pathname.split('/').pop();
    }

    if (!userId || isNaN(Number(userId))) return;

    const button = document.createElement('button');
    button.className = 'btn btn-outline-primary ml-2';
    button.setAttribute('data-user-info-button', 'true');
    button.innerHTML = '<i class="fas fa-user-circle"></i> User Info';

    chrome.storage.local.get(`user_${userId}`, (result) => {
        const hasData = result[`user_${userId}`] !== undefined;
        if (hasData) {
            button.classList.add('has-data');
        }
    });

    button.addEventListener('click', async () => {
        button.disabled = true;
        const loadingIcon = document.createElement('i');
        loadingIcon.className = 'fas fa-spinner fa-spin';
        const originalContent = button.innerHTML;
        button.innerHTML = '';
        button.appendChild(loadingIcon);

        try {
            await showUserInfo(Number(userId));
        } finally {
            button.innerHTML = originalContent;
            button.disabled = false;
        }
    });

    messageHeader.appendChild(button);
};



// Update user info button on URL changes
const urlChangeObserver = new MutationObserver(() => {
    requestAnimationFrame(addUserInfoButton);
});

urlChangeObserver.observe(document.body, {
    subtree: true,
    childList: true
});


// Modify showUserInfo function to handle non-existent user data
async function getMessageUrl(userId) {
    try {
        const response = await fetch(`https://www.dream-singles.com/${userId}.html`);
        const html = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const emailLink = doc.querySelector('a[href^="/members/messaging/compose/"]');
        return emailLink ? `https://www.dream-singles.com${emailLink.getAttribute('href')}` : null;
    } catch (error) {
        console.error('Error fetching message URL:', error);
        return null;
    }
}

const showUserInfo = async (userId) => {
    console.log(`Attempting to show user info for userId: ${userId}`);
    const numericUserId = Number(userId);
    if (!userId || isNaN(numericUserId)) {
        console.log('Invalid user ID, showing all stored data instead');
        showAllStoredData();
        return;
    }

    let infoDiv = document.getElementById('dream-user-info');
    if (infoDiv) {
        if (infoDiv.dataset.userId === numericUserId.toString()) {
            infoDiv.remove();
            return;
        }
        infoDiv.remove();
    }

    const messageUrl = await getMessageUrl(userId);

    chrome.storage.local.get([`user_${userId}`, 'subscribedIds'], (result) => {
        const userData = result[`user_${userId}`];
        const currentSubscribedIds = new Set(result.subscribedIds || []);
        const isAlreadySubscribed = currentSubscribedIds.has(Number(userId));
        
        console.log('Subscription check:', {
            userId,
            isAlreadySubscribed,
            currentSubscribedIds: Array.from(currentSubscribedIds),
            userData
        });
        console.log(`Retrieved user data for ${userId}:`, userData);
        
        // Check if current user is blocked by checking if their ID exists in blocked_users object
        const isBlocked = userData?.blocked_users && 
                         ownerUserId && 
                         userData.blocked_users[ownerUserId.toString()];
    
        infoDiv = document.createElement('div');
        infoDiv.id = 'dream-user-info';
        infoDiv.dataset.userId = userId.toString();
    
        const backgroundColor = isBlocked ? '#ffebee' : 'white';


        infoDiv.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            z-index: 9999;
            background: ${backgroundColor};
            border-radius: 8px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            max-width: 500px;
            width: 90%;
            padding: 20px;
        `;

        const content = document.createElement('div');
        content.style.cssText = 'color: #333;';

        content.innerHTML = `
            <div style="display: flex; gap: 15px; margin-bottom: 15px;">
                ${userData?.photo ? `
                    <img src="${userData.photo}" alt="Profile" style="width: 80px; height: 80px; border-radius: 8px; object-fit: cover; cursor: pointer;" onclick="window.open('https://www.dream-singles.com/${userId}.html', '_blank')">
                ` : ''}
                <div style="flex-grow: 1;">
                    <h3 style="margin: 0 0 10px 0; font-size: 18px; font-weight: 600;">
                        <span style="cursor: pointer; color: #4f46e5;" onclick="window.open('https://www.dream-singles.com/${userId}.html', '_blank')">${userData?.displayname || 'N/A'}</span> 
                        (<span style="cursor: pointer; color: #4f46e5;" onclick="window.open('https://www.dream-singles.com/${userId}.html', '_blank')">ID: ${userId}</span>)
                        ${isBlocked ? '<span style="color: #f44336; margin-left: 8px;">(Blocked You)</span>' : ''}
                    </h3>
                    <div style="display: flex; gap: 8px;">
                        <a href="https://www.dream-singles.com/members/chat?pid=${userId}" target="_blank" style="background: #4f46e5; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; text-decoration: none; ${isBlocked ? 'opacity: 0.5; pointer-events: none;' : ''}"><i class="fas fa-comments"></i> Chat</a>
                        <a href="${messageUrl || '#'}" target="_blank" style="background: #22c55e; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; text-decoration: none; ${!messageUrl || isBlocked ? 'opacity: 0.5; pointer-events: none;' : ''}"><i class="fas fa-envelope"></i> Message</a>
                    </div>
                </div>
            </div>
            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 15px;">
                ${userData ? `
                    <p style="margin: 0; font-size: 14px;"><strong>Credits:</strong> ${userData.credits || 0}</p>
                    <p style="margin: 0; font-size: 14px;"><strong>Minutes:</strong> ${userData.minutes || 0}</p>
                    <p style="margin: 0; font-size: 14px;"><strong>Plan:</strong> ${userData.plan || 'N/A'}</p>
                    <p style="margin: 0; font-size: 14px;"><strong>Birthday:</strong> ${userData.isBirthday ? 'Yes' : 'No'}</p>
                    <p style="margin: 0; font-size: 14px;"><strong>Blocked Users:</strong> ${userData.blocked_users ? Object.keys(userData.blocked_users).length : 'None'}</p>
                    <p style="margin: 0; font-size: 14px;"><strong>Last Update:</strong> ${new Date(userData.lastUpdate).toLocaleString(undefined, {
                        month: 'numeric',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    })}</p>

                   <p style="margin: 0; font-size: 14px; grid-column: 1 / -1;"><strong>Available countries:</strong> ${
    userData.female_countries ? 
    (Array.isArray(userData.female_countries) ? 
        userData.female_countries.map(code => COUNTRY_CODES[code] || code).join(', ') :
        (() => {
            try {
                const parsed = JSON.parse(userData.female_countries);
                return Array.isArray(parsed) ? 
                    parsed.map(code => COUNTRY_CODES[code] || code).join(', ') :
                    'Invalid format';
            } catch (e) {
                console.error('Error parsing countries:', e);
                return userData.female_countries;
            }
        })()
    ) : 'N/A'
}</p>
                ` : `
                    <p style="margin: 0; font-size: 14px; grid-column: 1 / -1;">No information available</p>
                    <button id="add-to-subscription" style="background: ${isAlreadySubscribed ? '#22c55e' : '#4f46e5'}; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: ${isAlreadySubscribed ? 'default' : 'pointer'}; font-size: 14px; grid-column: 1 / -1;" ${isAlreadySubscribed ? 'disabled' : ''}>${isAlreadySubscribed ? 'Already Subscribed' : 'Add to Subscription'}</button>
                `}
            </div>
            <button id="show-all-data" style="background: #4f46e5; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-size: 14px; width: 100%;">Show All Stored Data</button>
        `;

        infoDiv.appendChild(content);

        const closeButton = document.createElement('button');
        closeButton.innerHTML = '×';
        closeButton.style.cssText = `
            position: absolute;
            top: 10px;
            right: 10px;
            background: none;
            border: none;
            font-size: 24px;
            cursor: pointer;
            color: #666;
        `;
        closeButton.onclick = () => infoDiv.remove();
        infoDiv.appendChild(closeButton);

        document.body.appendChild(infoDiv);

        // Add event listener for the new subscription button
       
        const addToSubscriptionBtn = document.getElementById('add-to-subscription');
        if (addToSubscriptionBtn && !isAlreadySubscribed) {
            addToSubscriptionBtn.addEventListener('click', () => {
                console.log('Adding user to subscription:', userId);
                
                // Add loading spinner
                addToSubscriptionBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Adding...';
                addToSubscriptionBtn.disabled = true;
                
                chrome.storage.local.get(['subscribedIds'], (result) => {
                    const currentIds = new Set(result.subscribedIds || []);
                    currentIds.add(Number(userId));
                    
                    console.log('Updated subscribedIds:', Array.from(currentIds));
                    
                    chrome.storage.local.set({ 
                        subscribedIds: Array.from(currentIds) 
                    }, () => {
                        console.log('Successfully saved to storage');
                        subscribedIds.add(Number(userId));
                        addToSubscriptionBtn.innerHTML = 'Added to Subscription';
                        addToSubscriptionBtn.disabled = true;
                        addToSubscriptionBtn.style.backgroundColor = '#22c55e';
                        addToSubscriptionBtn.style.cursor = 'default';
                    });
                });
            });
        }

        const showAllButton = document.getElementById('show-all-data');
        if (showAllButton) {
            showAllButton.onclick = () => {
                infoDiv.remove();
                showAllStoredData();
            };
        }
    });
};



// Check if we're on a chat page and show user info if needed
let lastUserDataFetch = {};
const FETCH_DEBOUNCE_TIME = 1000; // 1 second

const checkForChatPage = () => {
    const url = new URL(window.location.href);
    const pathname = url.pathname;
    const params = new URLSearchParams(url.search);
    const pid = params.get('pid');

    console.log('Checking chat page:', { pathname, pid });

    if (pathname.includes('/members/chat') && pid) {
        console.log('Chat page detected with PID:', pid);
        const userId = Number(pid);
        if (!isNaN(userId)) {
            const now = Date.now();
            if (!lastUserDataFetch[userId] || (now - lastUserDataFetch[userId] > FETCH_DEBOUNCE_TIME)) {
                lastUserDataFetch[userId] = now;
            }
        } else {
            console.warn('Invalid user ID:', pid);
        }
    } else {
        console.log('Not on a chat page');
        const existingInfo = document.getElementById('dream-user-info');
        if (existingInfo) {
            existingInfo.remove();
        }
    }
};

// Run chat page check when page loads
if (document.readyState === 'complete') {
    checkForChatPage();
} else {
    window.addEventListener('load', checkForChatPage);
}

// Create URL observer to monitor chat page navigation
const urlObserver = new MutationObserver(() => {
    requestAnimationFrame(() => {
        // Only check for chat page changes, don't reopen modal
        const url = new URL(window.location.href);
        const pathname = url.pathname;
        const params = new URLSearchParams(url.search);
        const pid = params.get('pid');

        if (pathname.includes('/members/chat') && pid) {
            const userId = Number(pid);
            if (!isNaN(userId)) {
                const now = Date.now();
                if (!lastUserDataFetch[userId] || (now - lastUserDataFetch[userId] > FETCH_DEBOUNCE_TIME)) {
                    lastUserDataFetch[userId] = now;
                }
            }
        }
    });
});

// Start observing URL changes using a more reliable approach
const observeTarget = document.querySelector('body');
urlObserver.observe(observeTarget, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true
});

// Also observe the URL directly
let lastUrl = location.href;
setInterval(() => {
    if (location.href !== lastUrl) {
        lastUrl = location.href;
        checkForChatPage();
    }
}, 100);

// Handle history changes and hash changes
window.addEventListener('popstate', checkForChatPage);
window.addEventListener('hashchange', checkForChatPage);


// Removing duplicate declaration at line 746
function requestOnlineUsers(page = 1) {
    if (page <= MAX_PAGES && !initialDataReceived.onlinePages.has(page)) {
        sendMessage(ws, {
            type: "men-online",
            sort: "login",
            page: page,
        });
        initialDataReceived.onlinePages.add(page);
    }
};

function makeInitialRequest(type) {
    switch(type) {
        case 'favorites':
            sendMessage(ws, { type: "favorites-request" });
            requestTimestamps.favorites = Date.now();
            break;
        case 'contacts':
            sendMessage(ws, {
                type: "user-contacts-request",
                other_id: ""
            });
            requestTimestamps.contacts = Date.now();
            break;
        
    }
    console.log(`Made ${type} request at ${new Date().toISOString()}`);
};

function checkAndRetryRequests() {
    const now = Date.now();
    const isOnlineProcessing = initialDataReceived.onlinePages.size > 0 &&
                              !initialDataReceived.onlineFinished;

    // Проверяем контакты
    if (!initialDataReceived.contacts &&
        requestTimestamps.contacts &&
        (now - requestTimestamps.contacts > REQUEST_TIMEOUT)) {
        console.log('Retrying contacts request due to timeout');
        makeInitialRequest('contacts');
    }

    // Проверяем избранное
    if (!initialDataReceived.favorites &&
        requestTimestamps.favorites &&
        (now - requestTimestamps.favorites > REQUEST_TIMEOUT)) {
        console.log('Retrying favorites request due to timeout');
        makeInitialRequest('favorites');
    }

    // Логируем текущее состояние
    console.log('Current state:', {
        subscribedIds: subscribedIds.size,
        collectedIds: collectedIds.size,
        userDataMap: userDataMap.size,
        contactsReceived: initialDataReceived.contacts,
        favoritesReceived: initialDataReceived.favorites,
        onlinePagesProcessed: initialDataReceived.onlinePages.size,
        onlineFinished: initialDataReceived.onlineFinished,
        isOnlineProcessing
    });
};


function checkInitialDataComplete() {
    const isComplete = initialDataReceived.contacts &&
           initialDataReceived.favorites &&
           (initialDataReceived.onlinePages.size >= MAX_PAGES || initialDataReceived.onlineFinished);

    if (isComplete) {
        console.log("All initial data received, preparing final subscription");
        // Get all stored IDs and combine with newly collected ones
        chrome.storage.local.get(['subscribedIds'], (result) => {
            const storedIds = new Set(result.subscribedIds || []);
            const allUniqueIds = new Set([...storedIds, ...collectedIds]);

            if (allUniqueIds.size === 0) {
                console.log('No IDs to subscribe to');
                return;
            }

            // Check if we need to cleanup before processing
            if (allUniqueIds.size > MAX_SUBSCRIBED_IDS) {
                console.log(`Total unique IDs (${allUniqueIds.size}) exceeds limit. Initiating cleanup...`);
                cleanupSubscribedIds();
            }

            // Sort all unique IDs and send subscription request
            const sortedIds = Array.from(allUniqueIds).sort((a, b) => a - b);
            console.log(`Subscribing to ${sortedIds.length} unique IDs`);

            sendMessage(ws, {
                type: "presence-subscribe",
                payload: sortedIds
            });

            // Update storage and memory with complete set of IDs
            chrome.storage.local.set({ subscribedIds: sortedIds }, () => {
                console.log('Updated subscribedIds in storage');
            });
            subscribedIds = new Set(sortedIds);
            collectedIds.clear();
        });
    }

    return isComplete;
}

// Remove subscribeToAllCollectedIds function as it's no longer needed
        function initializeWebSocket() {
            console.log('Initializing WebSocket connection...');
            if (ws) {
                console.log('Closing existing WebSocket connection');
                ws.close();
            }

            ws = new WebSocket("wss://ws.dream-singles.com/ws");
            console.log('WebSocket instance created');

            ws.addEventListener("open", async () => {
                console.log("WebSocket connection established!");
                try {
                    console.log('Fetching JWT token...');
                    let response = await fetch("/members/jwtToken", {
                        headers: {
                            'X-Requested-With': 'XMLHttpRequest',
                            'Accept': 'application/json'
                        },
                        credentials: 'same-origin'  // Добавили эту строку
                    });

                    if (!response.ok) {
                        console.error(`JWT token fetch failed with status: ${response.status}`);
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }
                    let token = await response.text();
                    console.log('JWT token received successfully');

                    // Reset initial state
                    collectedIds.clear();
                    subscribedIds.clear();
                    initialDataReceived = {
                        contacts: false,
                        favorites: false,
                        onlinePages: new Set(),
                        onlineFinished: false
                    };

                    console.log('Sending authentication request...');
                    sendMessage(ws, {
                        type: "auth",
                        connection: "invite",
                        subscribe_to: [
                            "auth-response",
                            "presence-change",
                            "user-contacts-response",
                            "men-online-response",
                            "favorites-response"
                        ],
                        payload: token,
                    });
                } catch (error) {
                    console.error("Error during WebSocket initialization:", error);
                }
            });

    ws.addEventListener("message", (event) => {
        let data = JSON.parse(event.data);
        console.log(`WebSocket message received - Type: ${data.type}`);

        switch (data.type) {
            case "auth-response":
                console.log(`Authentication ${data.success ? 'successful' : 'failed'}`);
                if (data.success) {
                    console.log('Resetting data collections and initializing requests...');
                    cleanupSubscribedIds();
                    collectedIds.clear();
                    subscribedIds.clear();
                    initialDataReceived = {
                        contacts: false,
                        favorites: false,
                        onlinePages: new Set(),
                        onlineFinished: false
                    };

                    makeInitialRequest('favorites');
                    makeInitialRequest('contacts');
                    requestOnlineUsers(1);
                }
                break;

            case "user-contacts-response":
                if (data.payload) {
                    const newIds = Object.keys(data.payload).map(Number);
                    console.log(`Processing ${newIds.length} contacts from response`);
                    newIds.forEach(id => collectedIds.add(id));
                    initialDataReceived.contacts = true;
                    console.log('Contacts data received and processed');
                    checkInitialDataComplete();
                }
                break;

            case "favorites-response":
                if (data.payload) {
                    const newIds = data.payload.map(item => Number(item.profile_to));
                    console.log(`Processing ${newIds.length} favorites from response`);
                    newIds.forEach(id => collectedIds.add(id));
                    initialDataReceived.favorites = true;
                    console.log('Favorites data received and processed');
                    checkInitialDataComplete();
                }
                
                break;

            case "men-online-response":
                console.log('Processing online users response...');
                if (data.payload && Array.isArray(data.payload)) {
                    if (data.payload.length === 0) {
                        console.log('No more online users available - marking as finished');
                        initialDataReceived.onlineFinished = true;
                        checkInitialDataComplete();
                        return;
                    }

                    const newIds = data.payload.map(user => Number(user.id));
                    const currentPage = Math.max(...Array.from(initialDataReceived.onlinePages));
                    console.log(`Received ${newIds.length} online users from page ${currentPage}`);
                    newIds.forEach(id => collectedIds.add(id));
                    requestOnlineUsers(currentPage + 1);
                }
                break;

                case "presence-change":
                    if (data.from) {
                        console.log(`User ${data.from} presence changed to: ${data.status}`);
                        const {
                            id,
                            blocked_users,
                            credits,
                            displayname,
                            female_countries,
                            isBirthday,
                            photo,
                            minutes,
                            plan
                        } = data.user_data;
                        
                        updateUserData(data.user_data.id, {
                            status: data.status,
                            timestamp: data.timestamp,
                            id,
                            blocked_users,
                            credits,
                            displayname,
                            female_countries,
                            isBirthday,
                            photo,
                            minutes,
                            plan,
                            lastUpdate: new Date().toISOString()
                        });
                    }
                    break;

            default:
                console.log(`Unhandled message type: ${data.type}`);
        }
    });

    setInterval(checkAndRetryRequests, 5000);

    ws.addEventListener("close", () => {
        console.log("WebSocket connection closed");
        reconnectInterval = setTimeout(() => {
            console.log("Attempting to reconnect WebSocket...");
            window.location.reload();
        }, 5000);
    });

    ws.addEventListener("error", (error) => {
        console.error("WebSocket error occurred:", error);
    });
};

initializeWebSocket();

function addProfilePageButton() {
    const buttonContainer = document.querySelector('.button_container.text-left.mb20');
    if (buttonContainer) {
        const btnDiv = document.createElement('div');
        btnDiv.className = 'col-xs-6 col-sm-3 col-md-3 btn-icon pl5 pr5';

        const btn = document.createElement('a');
        btn.href = '#';
        btn.className = 'block btn btn-sm btn-blue-1';
        btn.setAttribute('data-user-info-button', 'true');
        btn.innerHTML = '<i class="icon-info-circled"></i> USER INFO';

        // Add animation styles if not already added
        if (!document.querySelector('#user-info-animations')) {
            const style = document.createElement('style');
            style.id = 'user-info-animations';
            style.textContent = `
                @keyframes pulse {
                    0% { transform: scale(1); }
                    50% { transform: scale(1.1); }
                    100% { transform: scale(1); }
                }
                .has-data {
                    animation: pulse 2s infinite;
                    background-color: #4f46e5 !important;
                    color: white !important;
                }
            `;
            document.head.appendChild(style);
        }
        
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            
            // Add loading state
            const originalContent = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
            btn.style.pointerEvents = 'none';

            try {
                const url = new URL(window.location.href);
                let userId = null;
                
                const zMatch = url.pathname.match(/\/z-(\d+)-/);
                if (zMatch) {
                    userId = zMatch[1];
                } else {
                    const directMatch = url.pathname.match(/\/(\d+)\.html$/);
                    if (directMatch) {
                        userId = directMatch[1];
                    }
                }

                if (userId && !isNaN(Number(userId))) {
                    await showUserInfo(Number(userId));
                }
            } finally {
                // Restore original state
                btn.innerHTML = originalContent;
                btn.style.pointerEvents = 'auto';
            }
        });

        // Check if we have data for this user
        const url = new URL(window.location.href);
        let userId = null;
        const zMatch = url.pathname.match(/\/z-(\d+)-/);
        if (zMatch) {
            userId = zMatch[1];
        } else {
            const directMatch = url.pathname.match(/\/(\d+)\.html$/);
            if (directMatch) {
                userId = directMatch[1];
            }
        }

        if (userId) {
            chrome.storage.local.get(`user_${userId}`, (result) => {
                if (result[`user_${userId}`]) {
                    btn.classList.add('has-data');
                }
            });
        }

        btnDiv.appendChild(btn);
        buttonContainer.appendChild(btnDiv);
    }
};

function addComposePageButton() {
    const writeButtons = document.querySelector('.row.mt10.write-buttons');
    if (writeButtons) {
        // Add animation styles if not already added
        if (!document.querySelector('#user-info-animations')) {
            const style = document.createElement('style');
            style.id = 'user-info-animations';
            style.textContent = `
                @keyframes pulse {
                    0% { transform: scale(1); }
                    50% { transform: scale(1.1); }
                    100% { transform: scale(1); }
                }
                .has-data {
                    animation: pulse 2s infinite;
                    background-color: #4f46e5 !important;
                    color: white !important;
                }
            `;
            document.head.appendChild(style);
        }

        const btnDiv = document.createElement('div');
        btnDiv.className = 'col-sm-3 col-xs-6 mb10';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'form-control btn btn-default';
        btn.setAttribute('data-user-info-button', 'true');
        btn.innerHTML = 'User Info';

        // Try to get user ID from profile block first
        let userId = null;
        const profileBlock = document.querySelector('#profile-blk-id');
        if (profileBlock) {
            const profileLink = profileBlock.querySelector('a[href*="/z-"]');
            if (profileLink) {
                const zMatch = profileLink.href.match(/\/z-(\d+)-/);
                if (zMatch) {
                    userId = zMatch[1];
                    console.log('Found user ID from profile block:', userId);
                }
            }
        }

        // If not found in profile block, try URL
        if (!userId) {
            const url = new URL(window.location.href);
            const pathParts = url.pathname.split('/');
            const urlId = pathParts[pathParts.length - 1];
            if (urlId && !isNaN(Number(urlId))) {
                userId = urlId;
                console.log('Found user ID from URL:', userId);
            }
        }

        if (userId && !isNaN(Number(userId))) {
            chrome.storage.local.get(`user_${userId}`, (result) => {
                if (result[`user_${userId}`]) {
                    btn.classList.add('has-data');
                }
            });
    
            btn.addEventListener('click', async () => {
                const originalContent = btn.innerHTML;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
                btn.disabled = true;
    
                try {
                    await showUserInfo(Number(userId));
                } finally {
                    btn.innerHTML = originalContent;
                    btn.disabled = false;
                }
            });

            // Add these lines to append the button
            btnDiv.appendChild(btn);
            writeButtons.appendChild(btnDiv);
        }
    }
};





// Handle history changes and hash changes
window.addEventListener('popstate', checkForChatPage);
window.addEventListener('hashchange', checkForChatPage);

} else if (null === e.trialStartedAt) {
        console.log('No subscription or trial found. Please start a trial or subscribe.');
    } else {
        console.log('Trial period has expired. Please subscribe to continue using the extension.');
    }
}).catch(err => {
    console.error('Error checking ExtPay subscription:', err);
});
