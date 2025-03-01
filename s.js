const extpay = ExtPay("dreamauto");
let countdownDisplay,
  textFields = [];
const delayedStartModal = document.getElementById('modalDelayedStart');
const delayedStartButton = document.getElementById('enableDelayedStart');
const closeDelayedStartModal = document.getElementById('closeDelayedStartModal');
const saveDelayedStart = document.getElementById('saveDelayedStart');
const clearDelayedStart = document.getElementById('clearDelayedStart');
const startHoursInput = document.getElementById('startHours');
const startMinutesInput = document.getElementById('startMinutes');
const selectedTimeDisplay = document.getElementById('selectedTimeDisplay');
function formatTime(e) {
  return Math.floor(e / 60) + ":" + ((e %= 60) < 10 ? "0" : "") + e;
}

function getTextFields() {
  for (let e = 1; e <= 50; e++) {
    let t = document.getElementById("text-" + e);
    t && textFields.push(t.value);
  }
}
function setTextFields() {
  for (let e = 1; e <= 50; e++) {
    let t = document.getElementById("text-" + e);
    t && (t.value = textFields[e - 1] || "");
  }
}
function clearTextFields() {
  for (let e = 1; e <= 50; e++) {
    let t = document.getElementById("text-" + e);
    t && (t.value = "");
  }
  textFields = [];
}

const telegramButton = document.getElementById("enableTelegram");
const telegramModal = document.getElementById("modalTelegram");
const saveTelegramSettings = document.getElementById("saveTelegramSettings");
const closeTelegramModal = document.getElementById("closeTelegramModal");
const botTokenInput = document.getElementById("botToken");
const chatIdInput = document.getElementById("chatId");
const telegramIcon = document.getElementById("telegramIcon");
chrome.storage.local.get(["botToken", "chatId"], function (result) {
  if (result.botToken && result.chatId) {
    telegramIcon.setAttribute("fill", "#0ff");
    telegramButton.classList.remove("disabled");
  } else {
    telegramIcon.setAttribute("fill", "#ff0000");
    telegramButton.classList.add("disabled");
  }
});

const clearTelegramFields = document.getElementById("clearTelegramFields");

clearTelegramFields.addEventListener("click", () => {
  botTokenInput.value = "";
  chatIdInput.value = "";

  chrome.storage.local.remove(["botToken", "chatId"], function () {
    console.log("Bot Token and Chat ID have been cleared.");
  });

  telegramIcon.setAttribute("fill", "#ff0000");
  telegramButton.classList.add("disabled");
});
telegramButton.addEventListener("click", () => {
  telegramModal.style.display = "block";

  chrome.storage.local.get(["botToken", "chatId"], function (result) {
    botTokenInput.value = result.botToken || "";
    chatIdInput.value = result.chatId || "";
  });
});
closeTelegramModal.addEventListener("click", () => {
  telegramModal.style.display = "none";
});
telegramModal.addEventListener("mousedown", function (event) {
  if (event.target === telegramModal) {
    telegramModal.style.display = "none";
  }
});
saveTelegramSettings.addEventListener("click", () => {
  const botToken = botTokenInput.value.trim();
  const chatId = chatIdInput.value.trim();

  if (botToken && chatId) {
    chrome.storage.local.set({ botToken, chatId }, function () {
      chrome.runtime.sendMessage(
        {
          action: "testTelegramNotification",
          botToken,
          chatId,
        },
        function (response) {
          if (response.success) {
            alert("The settings have been saved and tested successfully!");
            telegramButton.classList.remove("disabled");
            telegramIcon.setAttribute("fill", "#0ff");
            telegramModal.style.display = "none";
          } else {
            alert("Error when sending a test message: " + response.error);
          }
        }
      );
    });
  } else {
    alert("Please enter the bot token and chat ID.");
  }
});

function enableSound() {
  chrome.storage.local.get(["enableSounds", "botToken", "chatId"], (e) => {
    e.enableSounds
      ? (chrome.storage.local.set({ enableSounds: !1 }),
        chrome.runtime.sendMessage({ command: "disableSound" }),
        chrome.runtime.sendMessage({
          action: "updateNotificationState",
          enableTelegram: !1 && e.botToken && e.chatId,
        }),
        updateButtonState(!1))
      : (chrome.storage.local.set({ enableSounds: !0 }),
        chrome.runtime.sendMessage({ command: "enableSound" }),
        chrome.runtime.sendMessage({
          action: "updateNotificationState",
          enableTelegram: !0 && e.botToken && e.chatId,
        }),
        updateButtonState(!0));
  });
}
function updateButtonState(e) {
  let t = document.getElementById("enableSound");
  e
    ? ((t.innerHTML = "&#x1F50A"),
      t.classList.add("enabled"),
      t.classList.remove("disabled"))
    : ((t.innerHTML = "&#128263"),
      t.classList.add("disabled"),
      t.classList.remove("enabled"));
}
function handleStart() {
  chrome.runtime.sendMessage({ command: "start" });
}
function handleStop() {
  chrome.runtime.sendMessage({ command: "stop" }),
    (document.querySelector("#countdown-display").innerText =
      "Time before the next letter: 00:00");
  startHoursInput.value = '';
  startMinutesInput.value = '';
  selectedTimeDisplay.textContent = 'Not set';
  delayedStartButton.classList.add('disabled');
  delayedStartButton.classList.remove('active');
}
function handleSave() {
  getTextFields();
  console.log(textFields);

  const isEmpty = textFields.every((field) => !field.trim());
  if (isEmpty) {
    alert("You need to fill in the text area!");
  } else {
    chrome.runtime.sendMessage({ command: "save", textFields: textFields });
  }
}
function handleClear() {
  clearTextFields(), chrome.runtime.sendMessage({ command: "clear" });
  startHoursInput.value = '';
  startMinutesInput.value = '';
  selectedTimeDisplay.textContent = 'Not set';
  delayedStartButton.classList.add('disabled');
  delayedStartButton.classList.remove('active');
}
function init() {
  countdownDisplay = document.querySelector("#countdown-display");
  let e = document.getElementById("save-button");
  e && e.addEventListener("click", handleSave);
  let t = document.getElementById("clear-button");
  t && t.addEventListener("click", handleClear);
  let n = document.getElementById("stop-button");
  n && n.addEventListener("click", handleStop);
  let o = document.getElementById("start-button");
  o && o.addEventListener("click", handleStart);
  let a = document.getElementById("enableSound");
  a && a.addEventListener("click", enableSound);
  for (let e = 1; e <= 50; e++) {
    let t = document.getElementById("text-" + e);
    t &&
      t.addEventListener("input", function () {
        (textFields[e - 1] = t.value),
          chrome.storage.local.set({ textFields: textFields });
      });
  }
  chrome.storage.local.get(["textFields", "videoFields"], function (e) {
    e.textFields && ((textFields = e.textFields), setTextFields());
  }),
    extpay.onPaid.addListener(function () {
      window.location.reload();
    }),
    chrome.runtime.onMessage.addListener(function (e, t, n) {
      "update-countdown" === e.command
        ? (countdownDisplay.innerHTML = formatTime(e.time))
        : "update" === e.command &&
          chrome.storage.local.get(["textFields"], function (e) {
            textFields = e.textFields || [];
          });
    });
}

document.addEventListener("DOMContentLoaded", () => {
  chrome.storage.local.get("enableSounds", (e) => {
    updateButtonState(e.enableSounds);
  });
}),
  (window.onload = init);
var modal = document.getElementById("myModal"),
  span = document.getElementsByClassName("close")[0];
(span.onclick = function () {
  (modal.style.display = "none"), chrome.storage.local.set({ showModal: !1 });
}),
  chrome.storage.local.get(["version", "showModal"], function (e) {
    e.showModal &&
      ((modal.querySelector(".modal-content p").innerHTML =
        "Version: " +
        e.version +
        '<br><br>&mdash; Series mode Added.<br><br><br>Version: 2.0.0.1<br><br>&mdash; Major improvements.<br><br><br>Version: 1.1.0.0<br><br>&mdash; Added AI answer.<br><br><br>Version: 1.0.9.1<br><br>&mdash; Fixed bug with opening token url on login.<br><br><br>Version: 1.0.9.0<br><br>&mdash; Added User Info feature:<br>- Track users\' credits and minutes<br>- Monitor blocked status<br>- View user countries and plans<br>- Quick access to chat and messages<br>- Real-time data updates.<br><br><br>Version: 1.0.8.1<br><br>&mdash; Delayed start added.<br><br><br>Version: 1.0.8.0<br><br>&mdash; Auto reply added.<br><br>&mdash; Clicking on chat notification will open chat tabs for each member. <br><br>&mdash; Clicking on letter notification will open inbox. <br><br><br>Version: 1.0.7.2<br><br>&mdash; Changed the logic of sending TTS. Now it should first of all take the preset voice, if it is not found, then any Google American or British if they are not found then any possible voice.<br><br>&mdash; New letters: Changed logic. Now will check another element. <br><br><br>Version: 1.0.7.1<br><br>&mdash; Restored some lines which were lost due to testing. Added some new error detection options.<br><br><br>Version: 1.0.7.0<br><br>&mdash; Added the option to set up notifications via Telegram.<br><br><br>Version: 1.0.6.2<br><br>&mdash; Added logic to handle Chrome\'s error page.<br><br><br>Version: 1.0.6.1<br><br>&mdash; Minor fixes. Optimizations.<br><br><br>Version: 1.0.6<br><br>&mdash; The user can now decide if they want to exclude or include favorites.<br><br><br>Version: 1.0.5.5 - 1.0.5.4<br><br>&mdash; Changes to the UI again.<br><br><br>Version: 1.0.5.3<br><br>&mdash; Small changes to the UI.<br><br>&mdash; Some bugs with names, which caused a heavy memory load, have been fixed.<br><br><br>Version: 1.0.5.2<br><br>&mdash; More bugs fixed. <br><br><br>Version: 1.0.5.1<br><br>&mdash; Fixed minor bugs.<br><br><br>Version: 1.0.5<br><br>&mdash; Added Radio.<br>&mdash; The user can now open the browser that sent the notification by clicking on the notification.<br><br><br>Version: 1.0.4.3<br><br>&mdash; Added a bypass when the DS changes the chat page to the main page.<br><br><br>Version: 1.0.4.2<br><br>&mdash; Fixed a bug that caused the name to not show up in notifications.<br>&mdash; Notification Optimization.<br><br><br>Version: 1.0.4.1<br><br>&mdash; Added name to TTS in case you have more than 1 account to prevent confusion.<br><br><br>Version: 1.0.4<br><br>&mdash; Added TTS function as an audio notification.<br><br><br>Version: 1.0.3.1 <br><br>&mdash; Fixed a bug that caused the chat timer to not be assigned if the popup was closed after assignment.<br><br><br>Version: 1.0.3 <br><br>&mdash; Removed "Myjchina" from the start of the letter.<br>&mdash; Swapped notification icons.<br>&mdash; Fixed bug when tab was not defined during searching for new invites.<br><br><br>Version: 1.0.2 <br><br>&mdash; Added WS reconnection to prevent notifications from an inactive browser from not being received.<br>&mdash; Fixed notification count to 1 for each type to prevent spam.<br><br><br>Version: 1.0.1 <br><br>&mdash; Tab behavior changed.<br>&mdash; Changed logic for letter notification.<br>&mdash; Fixed bug with connecting to WS.<br>&mdash; Fixed bug making not possible to set letters without at least one video file.<br>&mdash; Fixed array bug when text is filled in two fields and the field between them is empty.<br>&mdash; Fixed a bug where chat invitations were triggered twice after opening the tab for the very first time.<br><br><br>Version: 1.0.0 <br><br>&mdash; Extensions are combined into one.<br>&mdash; Added functionality to set custom  chat invites. <br>&mdash; Added notifications about letters and chats.'),
      (modal.style.display = "block"));
  });
let popupPort = chrome.runtime.connect({ name: "popup" });
popupPort.onMessage.addListener(function (e) {
  e.countdownValue &&
    countdownDisplay &&
    (countdownDisplay.textContent = `Time before the next letter:\n    \n    ${formatTime(
      e.countdownValue
    )}`);
});
var payButton = document.createElement("button");
(payButton.id = "pay-button"),
  (payButton.innerText = "Pay"),
  (payButton.className = "center1"),
  payButton.addEventListener("click", function () {
    extpay.openPaymentPage();
  });
var trialButton = document.createElement("button");
(trialButton.id = "trial-button"),
  (trialButton.innerText = "Trial"),
  (trialButton.className = "center1"),
  trialButton.addEventListener("click", function () {
    extpay.openTrialPage("3-day");
  });
var loginButton = document.createElement("button");
(loginButton.id = "login-button"),
  (loginButton.innerText = "Login"),
  (loginButton.className = "center1"),
  loginButton.addEventListener("click", function () {
    extpay.openLoginPage();
  });
var modal1 = document.getElementById("myModal1");
(modal1.style.opacity = "0"),
  (modal1.style.transition = "opacity 1s"),
  setTimeout(function () {
    modal1.style.opacity = "1";
  }, 500),
  extpay.getUser().then((e) => {
    let t = new Date();
    e.paid
      ? (Date.parse(e.paidAt),
        t.getTime(),
        (document.getElementById("status").innerText =
          "You have an active subscription.\n"),
        (document.getElementById("checkStatus").innerText =
          "Check your status"),
        (document.getElementById("checkStatus").onclick = function () {
          extpay.openPaymentPage();
        }))
      : e.trialStartedAt && t - e.trialStartedAt < 2592e5
      ? (Date.parse(e.trialStartedAt),
        t.getTime(),
        (document.getElementById("status").innerText =
          "You have a trial period active.\n"),
        (document.getElementById("checkStatus").innerText = "Upgrade"),
        (document.getElementById("checkStatus").onclick = function () {
          extpay.openPaymentPage();
        }))
      : null === e.trialStartedAt
      ? ((modal1.querySelector(".modal1-content p").innerHTML =
          "No data about subscription. You can start free or log in<br>If you have any questions, feel free contacting mcjillz1@gmail.com or @Wp3ki4 on Telegram"),
        modal1.appendChild(payButton),
        modal1.appendChild(trialButton),
        modal1.appendChild(loginButton),
        (modal1.style.display = "block"))
      : e.trialStartedAt &&
        t - e.trialStartedAt > 2592e5 &&
        ((modal1.querySelector(".modal1-content p").innerHTML =
          "Trial expired, please pay to continue<br>If you have any questions, feel free contacting mcjillz1@gmail.com or @Wp3ki4 on Telegram"),
        modal1.appendChild(payButton),
        modal1.appendChild(loginButton),
        (modal1.style.display = "block"));
  });

document.addEventListener('DOMContentLoaded', function() {

  startHoursInput.setAttribute('maxlength', '2');
  startMinutesInput.setAttribute('maxlength', '2');


  const now = new Date();
  const currentHours = now.getHours().toString().padStart(2, '0');
  const currentMinutes = now.getMinutes().toString().padStart(2, '0');

  startHoursInput.setAttribute('placeholder', currentHours);
  startMinutesInput.setAttribute('placeholder', currentMinutes);

  function formatTimeInput(input, max) {
    let value = input.value.replace(/\D/g, '').slice(0, 2);
    if (value && parseInt(value) > max) {
      value = max.toString();
    }
    input.value = value;
  }

  function checkAndSave() {
    const hours = startHoursInput.value;
    const minutes = startMinutesInput.value;

    if (hours.length === 2 && minutes.length === 2) {
      saveDelayedStart.click();
    }
  }

  startHoursInput.addEventListener('input', () => {
    formatTimeInput(startHoursInput, 23);
    checkAndSave();

    if (startHoursInput.value.length === 2) {
      startMinutesInput.focus();
    }
  });

  startMinutesInput.addEventListener('input', () => {
    formatTimeInput(startMinutesInput, 59);
    checkAndSave();

    if (startMinutesInput.value.length === 2) {
      if (startHoursInput.value.length === 0) {
        startHoursInput.focus();
      } else {
        startMinutesInput.blur();
      }
    }
  });

  delayedStartButton.addEventListener('click', () => {
    delayedStartModal.style.display = 'block';
    startHoursInput.focus();

    chrome.storage.local.get(['delayedStartTime'], (result) => {
      if (result.delayedStartTime) {
        const time = new Date(result.delayedStartTime);
        startHoursInput.value = time.getHours().toString().padStart(2, '0');
        startMinutesInput.value = time.getMinutes().toString().padStart(2, '0');
        updateSelectedTimeDisplay(time);
      }
    });
  });

  closeDelayedStartModal.addEventListener('mousedown', () => {
    delayedStartModal.style.display = 'none';
  });

  delayedStartModal.addEventListener('click', (event) => {
    if (event.target === delayedStartModal) {
      delayedStartModal.style.display = 'none';
    }
  });

  clearDelayedStart.addEventListener('click', () => {
    startHoursInput.value = '';
    startMinutesInput.value = '';
    selectedTimeDisplay.textContent = 'Not set';
    chrome.runtime.sendMessage({ command: 'clearDelayedStart' });
    delayedStartButton.classList.add('disabled');
    delayedStartButton.classList.remove('active');
  });

  saveDelayedStart.addEventListener('click', () => {
    const hours = parseInt(startHoursInput.value);
    const minutes = parseInt(startMinutesInput.value);

    if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      alert('Please enter valid hours (0-23) and minutes (0-59)');
      return;
    }

    chrome.runtime.sendMessage({
      command: 'setDelayedStart',
      hours: hours,
      minutes: minutes
    });

    delayedStartButton.classList.add('active');
    delayedStartButton.classList.remove('disabled');
    delayedStartModal.style.display = 'none';
  });

  function updateSelectedTimeDisplay(time) {
    if (time) {
      selectedTimeDisplay.textContent =
          `${time.getHours().toString().padStart(2, '0')}:${time.getMinutes().toString().padStart(2, '0')}`;
    } else {
      selectedTimeDisplay.textContent = 'Not set';
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'delayedStartUpdate') {
      if (message.time) {
        const time = new Date(message.time);
        updateSelectedTimeDisplay(time);
        delayedStartButton.classList.add('active');
        delayedStartButton.classList.remove('disabled');
      } else {
        selectedTimeDisplay.textContent = 'Not set';
        delayedStartButton.classList.add('disabled');
        delayedStartButton.classList.remove('active');
      }
    }
  });
});

