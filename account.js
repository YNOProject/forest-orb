let sessionId = null;

function initAccountControls() {
  document.getElementById('loginButton').onclick = () => {
    document.getElementById('loginErrorRow').classList.add('hidden');
    openModal('loginModal');
  };
  document.getElementById('logoutButton').onclick = () => {
    apiFetch('logout')
      .then(response => {
        if (!response.ok)
          console.error(response.statusText);
      }).catch(err => console.error(err));
    setCookie('sessionId', '');
    fetchAndUpdatePlayerInfo();
  };

  document.getElementById('loginForm').onsubmit = function () {
    const form = this;
    closeModal();
    apiFetch(`login?${new URLSearchParams(new FormData(form)).toString()}`)
      .then(response => {
        if (!response.ok) {
          response.text().then(_ => {
            document.getElementById('loginError').innerHTML = getMassagedLabel(localizedMessages.account.login.errors.invalidLogin, true);
            document.getElementById('loginErrorRow').classList.remove('hidden');
            openModal('loginModal');
          });
          return;
        }
        return response.text();
      }).then(sId => {
        if (sId) {
          setCookie('sessionId', sId);
          fetchAndUpdatePlayerInfo();
        }
      }).catch(err => console.error(err));
    return false;
  };

  document.getElementById('registerForm').onsubmit = function () {
    const form = this;
    if (document.getElementById('registerPassword').value !== document.getElementById('registerConfirmPassword').value) {
      document.getElementById('registerError').innerHTML = getMassagedLabel(localizedMessages.account.register.errors.confirmPasswordMismatch, true);
      document.getElementById('registerErrorRow').classList.remove('hidden');
      return false;
    }
    closeModal();
    apiFetch(`register?${new URLSearchParams(new FormData(form)).toString()}`)
      .then(response => {
        if (!response.ok) {
          response.text().then(error => {
            document.getElementById('registerError').innerHTML = getMassagedLabel(localizedMessages.account.register.errors[error === 'user exists' ? 'usernameTaken' : 'invalidCredentials'], true);
            document.getElementById('registerErrorRow').classList.remove('hidden');
            openModal('registerModal');
          });
          return;
        }
        document.getElementById('loginErrorRow').classList.add('hidden');
        openModal('loginModal');
      })
      .catch(err => console.error(err));
    return false;
  };

  document.getElementById('accountSettingsButton').onclick = () => {
    initAccountSettingsModal();
    openModal('accountSettingsModal', null, 'settingsModal');
  };
}

function initAccountSettingsModal() {
  const badgeId = playerData?.badge || 'null';
  const badge = playerData?.badge ? badgeCache.find(b => b.badgeId === badgeId) : null;

  const accountBadgeButton = document.getElementById('accountBadgeButton');
  const badgeButton = document.getElementById('badgeButton');

  accountBadgeButton.innerHTML = getBadgeItem(badge || { badgeId: 'null' }, false, true, false, true).innerHTML;
  badgeButton.innerHTML = getBadgeItem(badge || { badgeId: 'null' }, false, true).innerHTML;

  if (gameId === '2kki' && badge?.overlayType & BadgeOverlayType.LOCATION) {
    handle2kkiBadgeOverlayLocationColorOverride(accountBadgeButton.querySelector('.badgeOverlay'), accountBadgeButton.querySelector('.badgeOverlay2'), cachedLocations);
    handle2kkiBadgeOverlayLocationColorOverride(badgeButton.querySelector('.badgeOverlay'), badgeButton.querySelector('.badgeOverlay2'), cachedLocations);
  }
}

function showAccountToastMessage(key, icon, username) {
  if (!notificationConfig.account.all || (notificationConfig.account.hasOwnProperty(key) && !notificationConfig.account[key]))
    return;
  let message = getMassagedLabel(localizedMessages.toast.account[key], true).replace('{USER}', username);
  showToastMessage(message, icon, true);
}