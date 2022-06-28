const gameIds = ['yume', '2kki', 'flow', 'prayers', 'deepdreams', 'someday', 'amillusion', 'unevendream', 'braingirl'];
const gameIdMatch = new RegExp('(?:' + gameIds.join('|') + ')').exec(window.location);
const gameId = gameIdMatch ? gameIdMatch[0] : gameIds[1];
const ynoGameId = gameIdMatch || !new RegExp('(?:dev)').exec(window.location) ? gameId : 'dev';
const localizedGameIds = [ 'yume', '2kki', 'flow', 'prayers', 'deepdreams', 'someday', 'amillusion', 'braingirl' ];
const gameDefaultLangs = {
  '2kki': 'ja',
  'flow': 'ja'
};
const gameDefaultSprite = {
  'yume': '0000000078',
  '2kki': 'syujinkou1',
  'flow': 'sabituki',
  'prayers': 'Flourette',
  'deepdreams': 'main',
  'someday': 'itsuki1',
  'amillusion': { sprite: 'parapluie ', idx: 1 },
  'unevendream': 'kubo',
  'braingirl': 'mikan2'
}[gameId];
const dependencyFiles = {};
const dependencyMaps = {};
const hasTouchscreen = window.matchMedia('(hover: none), (pointer: coarse)').matches;
const tippyConfig = {
  arrow: false,
  animation: 'scale',
  allowHTML: true
};

const apiUrl = `../connect/${ynoGameId}/api`;
const ynomojiUrlPrefix = 'images/ynomoji/';

Module = {
  INITIALIZED: false,
  EASYRPG_GAME: ynoGameId,
  EASYRPG_WS_URL: 'wss://ynoproject.net/connect/' + ynoGameId + '/'
};

function injectScripts() {
  let scripts = [ 'chat.js', 'playerlist.js', 'parties.js', 'system.js', '2kki.js', 'play.js', 'gamecanvas.js', 'index.js' ];

  dependencyFiles['play.css'] = null;

  const scriptTags = document.querySelectorAll('script');
  for (let tag of scriptTags) {
    if (tag.src.startsWith(window.location.origin))
      dependencyFiles[tag.src] = null;
  }
  for (let script of scripts)
    dependencyFiles[script] = null;
  dependencyFiles[`${window.location.origin}/data/${ynoGameId}/index.json`] = null;
  dependencyFiles['index.wasm'] = null;

  const injectScript = function (index) {
    const script = scripts[index];
    const loadFunc = index < scripts.length - 1
      ? () => injectScript(index + 1)
      : () => { // Assumes last script is index.js
        if (typeof ENV !== 'undefined')
          ENV.SDL_EMSCRIPTEN_KEYBOARD_ELEMENT = '#canvas';
  
        Module.postRun.push(() => {
          Module.INITIALIZED = true;
          const loadingOverlay = document.getElementById('loadingOverlay');
          loadingOverlay.classList.add('loaded');
          removeLoader(loadingOverlay);
          fetchAndUpdatePlayerInfo();
          fetchAndSendSyncedPictures();
          setInterval(checkLogin, 60000);
          setTimeout(() => {
            checkDependenciesModified();
            setInterval(checkDependenciesModified, 300000);
          }, 10000);
          window.onbeforeunload = function () {
            return localizedMessages.leavePage;
          };
        });
        if (typeof onResize !== 'undefined')
          Module.postRun.push(onResize);
      };

    const scriptTag = document.createElement('script');
    scriptTag.type = 'text/javascript';
    scriptTag.src = script;
    scriptTag.onload = loadFunc;

    document.body.appendChild(scriptTag);
  };

  injectScript(0);
}

function checkDependencyModified(filename, onLoaded, onChecked) {
  const xhr = new XMLHttpRequest();
  xhr.open('get', filename, true);
  xhr.onreadystatechange = () => {
    if (xhr.readyState == 4) {
      if (dependencyFiles.hasOwnProperty(filename)) {
        if (onChecked)
          onChecked(xhr)
      } else {
        if (onLoaded)
          onLoaded(xhr)

        dependencyFiles[filename] = xhr.getResponseHeader('Last-Modified');

        xhr.open('get', filename, true);
        xhr.setRequestHeader('If-Modified-Since', dependencyFiles[filename]);
        xhr.send(null);
      }
    }
  };
  xhr.send(null);
}

function checkDependenciesModified() {
  let hasChanges = false;
  const dependencyPaths = Object.keys(dependencyFiles);
  const checkDependency = function (index) {
    const dep = dependencyPaths[index];
    const hasLastModified = !!dependencyFiles[dep];
    const req = hasLastModified ? { headers: { 'If-Modified-Since': dependencyFiles[dep] }} : {};

    fetch(dep, req)
      .then(response => {
        if (!hasLastModified || (response.status === 200 && response.headers.has('Last-Modified')))
          dependencyFiles[dep] = response.headers.get('Last-Modified');
        if (hasLastModified && response.status === 200)
          hasChanges = true;
      })
      .catch(err => {
        console.error(err);
      })
      .finally(() => {
        if (!hasLastModified && dependencyFiles[dep])
          checkDependency(index);
        else if (index < dependencyPaths.length - 1)
          checkDependency(index + 1);
        else if (hasChanges)
          showSystemToastMessage('siteUpdates', 'info');
      });
  };
  if (dependencyPaths.length)
    checkDependency(0);
}

function fetchNewest(path, important, req) {
  return new Promise((resolve, reject) => {
    let ret;
    if (!req)
      req = {};

    fetch(path, req)
      .then(response => {
        ret = response;
        if (response.headers.has('Last-Modified')) {
          const lastModified = response.headers.get('Last-Modified');
          if (!req.headers)
            req.headers = {};
          req.headers['If-Modified-Since'] = lastModified;
          if (important)
            dependencyFiles[path] = lastModified;
          fetch(path, req)
            .then(response => {
              if (response.status === 200)
                ret = response;
              resolve(ret);
            })
            .catch(err => reject(err));
        } else
          resolve(ret);
      })
      .catch(err => reject(err));;
  });
}

function apiFetch(path) {
  return new Promise((resolve, reject) => {
    const sId = getCookie('sessionId');
    const headers = sId ? { 'X-Session': sId } : {};
    fetch(`${apiUrl}/${path}`, { headers: headers })
      .then(response => resolve(response))
      .catch(err => reject(err));
  });
}

function apiJsonPost(path, data) {
  return new Promise((resolve, reject) => {
    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };
    const sId = getCookie('sessionId');
    if (sId)
      headers['X-Session'] = sId;
    fetch(`${apiUrl}/${path}`, { method: 'POST', headers: headers, body: JSON.stringify(data) })
      .then(response => resolve(response))
      .catch(err => reject(err));
  });
}

function getSpriteImg(img, spriteData, sprite, idx, frameIdx, width, height, xOffset, hasYOffset, isBrave) {
  return new Promise(resolve => {
    const canvas = document.createElement('canvas');
    canvas.width = 24;
    canvas.height = 32;
    const context = canvas.getContext('2d');
    const startX = (idx % 4) * 72 + 24 * frameIdx;
    const startY = (idx >> 2) * 128 + 64;
    context.drawImage(img, startX, startY, 24, 32, 0, 0, 24, 32);
    const imageData = context.getImageData(0, 0, 24, 32);
    const data = imageData.data;
    const transPixel = data.slice(0, 3);
    let yOffset = hasYOffset ? -1 : 0;
    const checkPixelTransparent = isBrave
      ? o => (data[o] === transPixel[0] || data[o] - 1 === transPixel[0]) && (data[o + 1] === transPixel[1] || data[o + 1] - 1 === transPixel[1]) && (data[o + 2] === transPixel[2] || data[o + 2] - 1 === transPixel[2])
      : o => data[o] === transPixel[0] && data[o + 1] === transPixel[1] && data[o + 2] === transPixel[2];
    for (let i = 0; i < data.length; i += 4) {
      if (checkPixelTransparent(i))
        data[i + 3] = 0;
      else if (yOffset === -1)
        yOffset = Math.max(Math.min(i >> 7, 15), 3);
    }
    if (yOffset === -1)
      yOffset = 0;
    canvas.width = width;
    canvas.height = height;
    context.putImageData(imageData, xOffset * -1, yOffset * -1, xOffset, 0, 24, 32);
    canvas.toBlob(blob => {
      const blobImg = document.createElement('img');
      const url = URL.createObjectURL(blob);
    
      blobImg.onload = () => URL.revokeObjectURL(url);
    
      if (Array.isArray(spriteData[sprite][idx]))
        spriteData[sprite][idx][frameIdx] = url;
      else
        spriteData[sprite][idx] = url;
      canvas.remove();
      resolve(url);
    });
  });
}

function addTooltip(target, content, asTooltipContent, delayed, interactive, options) {
  if (!options)
    options = {};
  if (interactive)
    options.interactive = true;
  if (delayed)
    options.delay = [750, 0];
  options.content = asTooltipContent ? `<div class="tooltipContent">${content}</div>` : content;
  options.appendTo = document.getElementById('layout');
  target._tippy?.destroy();
  return tippy(target, Object.assign(options, tippyConfig));
}

function addAdminContextMenu(target, player, uuid) {
  if (!player)
    return;

  const playerName = getPlayerName(player, true);
  
  let tooltipHtml = `<a href="javascript:void(0);" class="banPlayerAction">${getMassagedLabel(localizedMessages.context.admin.ban.label, true).replace('{PLAYER}', playerName)}</a>`;
  if (player.account)
    tooltipHtml += `<br>
      <a href="javascript:void(0);" class="grantBadgeAction adminBadgeAction">${getMassagedLabel(localizedMessages.context.admin.grantBadge.label, true)}</a><br>
      <a href="javascript:void(0);" class="revokeBadgeAction adminBadgeAction">${getMassagedLabel(localizedMessages.context.admin.revokeBadge.label, true)}</a>`;

  const adminTooltip = addTooltip(target, tooltipHtml, true, false, true, { trigger: 'manual' });

  adminTooltip.popper.querySelector('.banPlayerAction').onclick = function () {
    if (confirm(localizedMessages.context.admin.ban.confirm.replace('{PLAYER}', playerName))) {
      apiFetch(`admin?command=ban&player=${uuid}`)
        .then(response => {
          if (!response.ok)
            throw new Error(response.statusText);
          return response.text();
        })
        .then(_ => showToastMessage(getMassagedLabel(localizedMessages.context.admin.ban.success, true).replace('{PLAYER}', playerName), 'ban', true, systemName))
        .catch(err => console.error(err));
    }
  };

  const badgeActions = adminTooltip.popper.querySelectorAll('.adminBadgeAction');
  for (let badgeAction of badgeActions) {
    badgeAction.onclick = function () {
      const isGrant = this.classList.contains('grantBadgeAction');
      const localizedContextRoot = localizedMessages.context.admin[isGrant ? 'grantBadge' : 'revokeBadge'];
      const badgeId = prompt(localizedContextRoot.prompt.replace('{PLAYER}', playerName));
      if (badgeId) {
        const badgeGame = Object.keys(localizedBadges).find(game => {
          return Object.keys(localizedBadges[game]).find(b => b === badgeId);
        });
        if (badgeGame) {
          const badgeName = localizedBadges[badgeGame][badgeId].name;
          apiFetch(`admin?command=${isGrant ? 'grant' : 'revoke'}badge&player=${uuid}&id=${badgeId}`)
            .then(response => {
              if (!response.ok)
                throw new Error(response.statusText);
              return response.text();
            })
            .then(_ => showToastMessage(getMassagedLabel(localizedContextRoot.success, true).replace('{BADGE}', badgeName).replace('{PLAYER}', playerName), 'info', true, systemName))
            .catch(err => console.error(err));
        } else
          alert(localizedContextRoot.fail);
      }
    };
  }

  target.addEventListener('contextmenu', event => {
    event.preventDefault();
  
    adminTooltip.setProps({
      getReferenceClientRect: () => ({
        width: 0,
        height: 0,
        top: event.clientY,
        bottom: event.clientY,
        left: event.clientX,
        right: event.clientX,
      }),
    });
  
    adminTooltip.show();
  });
}

function addOrUpdateTooltip(target, content, asTooltipContent, delayed, interactive, options, instance) {
  if (!instance)
    return addTooltip(target, content, asTooltipContent, delayed, interactive, options);

  instance.setContent(asTooltipContent ? `<div class="tooltipContent">${content}</div>` : content);
  return instance;
}

let loadedLang = false;
let loadedUiTheme = false;
let loadedFontStyle = false;

function loadOrInitConfig(configObj, global, configName) {
  if (!configName)
    configName = 'config';
  try {
    const configKey = global ? configName : `${configName}_${ynoGameId}`;
    if (!window.localStorage.hasOwnProperty(configKey))
      window.localStorage.setItem(configKey, JSON.stringify(configObj));
    else {
      let savedConfig = JSON.parse(window.localStorage.getItem(configKey));
      if (configName === 'notificationConfig')
        savedConfig = Object.assign(notificationConfig, savedConfig);
      const savedConfigKeys = Object.keys(savedConfig);
      for (let k in savedConfigKeys) {
        const key = savedConfigKeys[k];
        if (configObj.hasOwnProperty(key)) {
          let value = savedConfig[key];
          switch (configName) {
            case 'config':
              if (global) {
                switch (key) {
                  case 'lang':
                    document.getElementById('lang').value = value;
                    setLang(value, true);
                    loadedLang = true;
                    break;
                  case 'name':
                    document.getElementById('nameInput').value = value;
                    setName(value, true);
                    break;
                  case 'tabToChat':
                    if (!value)
                      document.getElementById('tabToChatButton').click();
                    break;
                  case 'hideRankings':
                    if (value)
                      document.getElementById('toggleRankingsButton').click();
                    break;
                  case 'disableFloodProtection':
                    if (value)
                      preToggle(document.getElementById('floodProtectionButton'));
                    break;
                }
              } else {
                switch (key) {
                  case 'singlePlayer':
                    if (value)
                      preToggle(document.getElementById('singlePlayerButton'));
                    break;
                  case 'disableChat':
                    if (value)
                      document.getElementById('chatButton').click();
                    break;
                  case 'disableNametags':
                    if (value)
                      preToggle(document.getElementById('nametagButton'));
                    break;
                  case 'disablePlayerSounds':
                    if (value)
                      preToggle(document.getElementById('playerSoundsButton'));
                    break;
                  case 'immersionMode':
                    if (value)
                      document.getElementById('immersionModeButton').click();
                    break;
                  case 'chatTabIndex':
                    if (value) {
                      const chatTab = document.querySelector(`.chatTab:nth-child(${value + 1})`);
                      if (chatTab && value !== 2)
                        setChatTab(chatTab);
                    }
                    break;
                  case 'playersTabIndex':
                    if (value) {
                      const playersTab = document.querySelector(`.playersTab:nth-child(${value + 1})`);
                      if (playersTab && value !== 1)
                        setPlayersTab(playersTab);
                    }
                    break;
                  case 'globalMessage':
                    if (value)
                      document.getElementById('globalMessageButton').click();
                    break;
                  case 'hideOwnGlobalMessageLocation':
                    if (value)
                      preToggle(document.getElementById('ownGlobalMessageLocationButton'));
                    break;
                  case 'uiTheme':
                    if (gameUiThemes.indexOf(value) > -1) {
                      document.querySelector('.uiTheme').value = value;
                      setUiTheme(value, true);
                      loadedUiTheme = true;
                    }
                    break;
                  case 'fontStyle':
                    if (gameUiThemes.indexOf(value) > -1) {
                      document.querySelector('.fontStyle').value = value;
                      setFontStyle(value, true);
                      loadedFontStyle = true;
                    }
                    break;
                }
              }
              break;
            case 'notificationConfig':
              switch (key) {
                case 'all':
                  if (!value)
                    document.getElementById('notificationsButton').click();
                  break;
                case 'screenPosition':
                  if (value && value !== 'bottomLeft')
                    setNotificationScreenPosition(value);
                  break;
                default:
                  if (notificationTypes.hasOwnProperty(key) && typeof value === 'object') {
                    for (let nkey of Object.keys(value)) {
                      const nvalue = value[nkey];
                      if (nkey === 'all') {
                        if (!nvalue)
                          document.getElementById(`notificationsButton_${key}`).click();
                      } else if (notificationTypes[key].indexOf(nkey) > -1) {
                        if (!nvalue)
                          document.getElementById(`notificationsButton_${key}_${nkey}`).click();
                      } else
                        continue;
                    }
                  } else
                    continue;
                  break;
              }
              break;
            case 'saveSyncConfig':
              switch (key) {
                case 'enabled':
                  if (value)
                    setSaveSyncEnabled(true, true);
                  break;
                case 'slotId':
                  document.getElementById('saveSyncSlotId').value = value;
                  break;
              }
              break;
          }
          configObj[key] = value;
        }
      }
    }
  } catch (error) {
    console.error(error);
  }
}

function updateConfig(configObj, global, configName) {
  if (!configName)
    configName = 'config';
  try {
    window.localStorage[global ? configName : `${configName}_${ynoGameId}`] = JSON.stringify(configObj);
  } catch (error) {
    console.error(error);
  }
}

function setCookie(cName, cValue) {
  document.cookie = `${cName}=${cValue};SameSite=Strict;path=/`;
}

function getCookie(cName) {
  const name = `${cName}=`;
  const ca = document.cookie.split(';');
  for (let i = 0; i < ca.length; i++) {
    let c = ca[i];
    while (c.charAt(0) === ' ')
      c = c.substring(1);
    if (c.indexOf(name) === 0)
      return c.substring(name.length, c.length);
  }
  return "";
}

(function() {
  initNotificationsConfigAndControls();
  loadOrInitConfig(notificationConfig, true, 'notificationConfig');

  initSaveSyncControls();
  loadOrInitConfig(saveSyncConfig, false, 'saveSyncConfig');

  window.addEventListener('error', () => showSystemToastMessage('error', 'important'));

  if (!getCookie('sessionId') || !saveSyncConfig.enabled || !saveSyncConfig.slotId)
    injectScripts();
  else
    trySyncSave().then(_ => injectScripts());
})();