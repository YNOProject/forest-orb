/**
  @typedef {Object} Badge
  @property {string} badgeId
  @property {string} game
  @property {string} group
  @property {number} [mapX] available when full=true
  @property {number} [mapY] available when full=true
  @property {boolean} newUnlock
  Either SimpleBadge or Badge
  Cross-check with badges.go in ynoserver
*/

/**
  @typedef {Badge[] & {full?: true}} BadgeCache
*/

const maxBadgeSlotRows = 8;
const maxBadgeSlotCols = 7;
let badgeSlotRows = 1;
let badgeSlotCols = 3;

/** @type {BadgeCache?} */
let badgeCache;
/** @type {string[][]} row-major */
let badgeSlotCache;
let badgeFilterCache = [];
let badgeCacheUpdateTimer = null;
let badgeTabGame = gameId;
let badgeTabGroup;

let localizedBadgeGroups;
let localizedBadges;
let localizedBadgesIgnoreUpdateTimer = null;

let badgeGameIds = [];

const assignTooltipCallbacks = new WeakMap;

const badgeGalleryModalContent = document.querySelector('#badgeGalleryModal .modalContent');

/** @type {IntersectionObserver?} */
let observer;

const badgeGalleryRowBpLevels = [
  {
    bp: 300,
    count: 1
  },
  {
    bp: 1000,
    count: 2
  },
  {
    bp: 2000,
    count: 3
  },
  {
    bp: 4000,
    count: 4
  },
  {
    bp: 7500,
    count: 5
  },
  {
    bp: 12500,
    count: 6
  },
  {
    bp: 20000,
    count: 7
  },
  {
    bp: 30000,
    count: 8
  },
  {
    bp: 50000,
    count: 9
  },
  {
    bp: 0,
    count: 10
  }
];
const badgeGalleryColBcLevels = [
  {
    bc: 50,
    count: 3
  },
  {
    bc: 150,
    count: 4
  },
  {
    bc: 300,
    count: 5
  },
  {
    bc: 500,
    count: 6
  },
  {
    bc: 0,
    count: 7
  }
];
const badgeSortOrderTypes = {
  'bp': (a, b, desc) => {
    if (a.bp === b.bp)
      return 0;
    return a.bp > b.bp === desc ? -1 : 1;
  },
  'percent': (a, b, desc) => {
    if (a.percent === b.percent)
      return 0;
    return a.percent > b.percent === desc ? -1 : 1;
  }
};
const BadgeOverlayType = {
  GRADIENT: 1,
  MULTIPLY: 2,
  MASK: 4,
  DUAL: 8,
  LOCATION: 16
};

function yieldImmediately() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function initBadgeControls() {
  const badgeModalContent = document.querySelector('#badgesModal .modalContent');
  const badgeGameTabs = document.getElementById('badgeGameTabs');
  const badgeCategoryTabs = document.getElementById('badgeCategoryTabs');

  const sortOrder = document.getElementById('badgeSortOrder');

  for (let sot of Object.keys(badgeSortOrderTypes)) {
    const optionAsc = document.createElement('option');
    const optionDesc = document.createElement('option');

    optionAsc.value = sot;
    optionDesc.value = `${sot}_desc`;

    sortOrder.appendChild(optionAsc);
    sortOrder.appendChild(optionDesc);
  }

  /** @type {Record<string, Record<string, HTMLDivElement[]>>?} */
  let gameBadges;
  let badgeCompareFunc;
  let didUpdateBadgeModal;
  let lastLang;
  const fetchAndUpdateBadgeModalBadges = (slotRow, slotCol) => {
    if (slotRow && slotCol)
      modifyingSlot = { slotRow, slotCol };
    else
      modifyingSlot = null;
    const sortOrderDesc = sortOrder.value.endsWith('_desc');
    const sortOrderType = sortOrderDesc ? sortOrder.value.slice(0, -5) : sortOrder.value;
    badgeCompareFunc = (a, b) => {
      // game > group > subcriteria
      if (a.game !== b.game) {
        if (a.game === 'ynoproject')
          return -1;
        if (b.game === 'ynoproject')
          return 1;
        if (a.game === gameId)
          return -1;
        if (b.game === gameId)
          return 1;
        return (badgeGameIds || gameIds).indexOf(a.game) < (badgeGameIds || gameIds).indexOf(b.game) ? -1 : 1;
      }
      if (sortOrderType) {
        if (a.group !== b.group) {
          if (a.group < b.group)
            return -1;
          return 1;
        }
        return badgeSortOrderTypes[sortOrderType](a, b, sortOrderDesc);
      }
      return 0;
    };

    // If we already have cache and it hasn't been invalidated, only update the modal.
    if (gameBadges && badgeCache?.full && lastLang === globalConfig.lang) return updateBadgeModalOnly();
    lastLang = globalConfig.lang;

    fetchPlayerBadges(async playerBadges => {
      badgeFilterCache.length = 0;
      playerBadges.sort(badgeCompareFunc);
      gameBadges = {};
      const spacePattern = / /g;
      let badgeCount = 0;
      observer?.disconnect();
      observer = new IntersectionObserver(observed => {
        for (const { target } of observed) {
          if (!target.parentElement) continue;
          const assignTooltip = assignTooltipCallbacks.get(target);
          if (assignTooltip) {
            observer.unobserve(target);
            assignTooltipCallbacks.delete(target);
            window.requestAnimationFrame(() => assignTooltip());
          }
        }
      }, { root: badgeModalContent });
      let systemName;
      for (const badge of playerBadges) {
        // yield back to the game loop to prevent audio cracking
        if (badgeCount++ % 150 === 0) await yieldImmediately();

        if (!gameBadges[badge.game]) {
          if (badge.game !== 'ynoproject') {
            systemName = getDefaultUiTheme(badge.game).replace(spacePattern, '_');
          }
          if (systemName) {
            const parsedSystemName = systemName;
            initUiThemeContainerStyles(parsedSystemName, badge.game, false, () => initUiThemeFontStyles(parsedSystemName, badge.game, 0));
          }
          gameBadges[badge.game] = {};
        }
        if (!gameBadges[badge.game][badge.group]) gameBadges[badge.game][badge.group] = [];

        const item = getBadgeItem(badge, 'lazy', true, true, true, true, systemName);
        observer.observe(item);
        if (badge.badgeId === (playerData?.badge || 'null'))
          item.children[0].classList.add('selected');
        if (!item.classList.contains('disabled')) {
          item.onclick = () => onClickBadge(badge.badgeId);
        }
        gameBadges[badge.game][badge.group].push(item);
      }


      const nullBadge = getBadgeItem({ badgeId: 'null', game: null }, false, true, true, true);
      if ('null' === (playerData?.badge || 'null'))
        nullBadge.children[0].classList.add('selected');
      if (!nullBadge.classList.contains('disabled')) {
        nullBadge.onclick = () => onClickBadge('null');
      }

      function updateBadges(game, group) {
        const items = gameBadges[game]?.[group] || [];
        if (game !== 'ynoproject') {
          const systemName = getDefaultUiTheme(game).replace(spacePattern, '_');
          applyThemeStyles(nullBadge, systemName, game);
        } else {
          for (const cls of nullBadge.classList)
            if (cls.startsWith('theme_'))
              nullBadge.classList.remove(cls);
        }
        badgeModalContent.replaceChildren(nullBadge, ...items);
        badgeTabGame = game;
        badgeTabGroup = group;
      }

      const tabs = [];
      {
        // Create 'All' tab
        const tab = document.createElement('div');
        tabs.push(tab);
        tab.classList.add('badgeGameTab', 'modalTab');
        if (badgeTabGame === 'all') tab.classList.add('active');

        const tabLabel = document.createElement('label');
        tabLabel.classList.add('badgeGameTabLabel', 'modalTabLabel', 'unselectable');
        tabLabel.innerHTML = getMassagedLabel(localizedMessages.badges.allCategory);
        tab.appendChild(tabLabel);

        tab.onclick = () => {
          if (badgeGameTabs === 'all') return;

          badgeGameTabs.querySelector('.active')?.classList.remove('active');
          tab.classList.add('active');
          badgeCategoryTabs.replaceChildren();

          window.requestAnimationFrame(() => {
            badgeModalContent.replaceChildren(nullBadge);
            for (const cls of nullBadge.classList)
              if (cls.startsWith('theme_'))
                nullBadge.classList.remove(cls);
            for (const game in gameBadges)
              for (const category in gameBadges[game])
                badgeModalContent.append(...gameBadges[game][category]);
            badgeTabGame = 'all';
            badgeTabGroup = null;
          });
        }; // tab.onclick
      }

      for (const game in gameBadges) {
        if (!badgeTabGame) badgeTabGame = game;

        const tab = document.createElement('div');
        tabs.push(tab);
        tab.classList.add('badgeGameTab', 'modalTab');
        tab.dataset.game = game;
        if (game === badgeTabGame) tab.classList.add('active');

        const tabLabel = document.createElement('label');
        tabLabel.classList.add('badgeGameTabLabel', 'modalTabLabel', 'unselectable');
        tabLabel.innerHTML = getMassagedLabel(localizedMessages.games[game]);
        tab.appendChild(tabLabel);

        tab.onclick = () => {
          if (tab.dataset.game === badgeTabGame) return;

          badgeGameTabs.querySelector('.active')?.classList.remove('active');
          tab.classList.add('active');

          const subTabs = [];
          if (badgeTabGame || !badgeTabGroup) badgeTabGroup = 'all';
          let hasGroups = true;

          for (const group in gameBadges[game]) {
            if (!group) {
              // Group name is empty, game's badges have no group subdivision.
              badgeTabGroup = group;
              hasGroups = false;
              break;
            }
            const subTab = document.createElement('div');
            subTab.classList.add('subTab');
            subTab.dataset.group = group;
            subTab.dataset.game = game;
            if (group === badgeTabGroup) subTab.classList.add('active');

            const subTabLabel = document.createElement('small');
            subTabLabel.classList.add('badgeCategoryTabLabel', 'subTabLabel', 'infoLabel', 'unselectable');
            subTabLabel.innerHTML = getMassagedLabel(localizedBadgeGroups[game][group]);
            subTabs.push(subTab);
            subTab.appendChild(subTabLabel);

            const subTabBg = document.createElement('div');
            subTabBg.classList.add('subTabBg');
            subTab.appendChild(subTabBg);

            subTab.onclick = () => {
              if (subTab.dataset.group === badgeTabGroup) return;

              badgeCategoryTabs.querySelector('.active')?.classList.remove('active');
              subTab.classList.add('active');

              updateBadges(subTab.dataset.game, subTab.dataset.group);
            };
          }

          if (hasGroups) {
            // Create 'All' subtab
            const subTab = document.createElement('div');
            subTabs.unshift(subTab);
            subTab.classList.add('subTab');
            subTab.dataset.game = game;
            if ('all' === badgeTabGroup) subTab.classList.add('active');

            const subTabLabel = document.createElement('small');
            subTabLabel.classList.add('badgeCategoryTabLabel', 'subTabLabel', 'infoLabel', 'unselectable');
            subTabLabel.innerHTML = getMassagedLabel(localizedMessages.badges.allCategory);
            subTab.appendChild(subTabLabel);

            const subTabBg = document.createElement('div');
            subTabBg.classList.add('subTabBg');
            subTab.appendChild(subTabBg);

            subTab.onclick = () => {
              if ('all' === badgeTabGroup) return;

              window.requestAnimationFrame(() => {
                badgeCategoryTabs.querySelector('.active')?.classList.remove('active');
                subTab.classList.add('active');

                const game = tab.dataset.game;
                if (game !== 'ynoproject') {
                  const systemName = getDefaultUiTheme(game).replace(spacePattern, '_');
                  applyThemeStyles(nullBadge, systemName, game);
                } else {
                  for (const cls of nullBadge.classList)
                    if (cls.startsWith('theme_'))
                      nullBadge.classList.remove(cls);
                }

                badgeModalContent.replaceChildren(nullBadge);
                for (const group in gameBadges[game])
                  badgeModalContent.append(...gameBadges[game][group]);
                badgeTabGame = game;
                badgeTabGroup = 'all';
              });
            };
          }

          badgeCategoryTabs.replaceChildren(...subTabs);
          if (badgeCategoryTabs.querySelector('[data-i18n]')) {
            // accommodates translated tooltips in the format of <element data-i18n='[title]...'/>
            locI18next.init(i18next)('[data-i18n]', { document: badgeCategoryTabs });
            for (const elm of badgeCategoryTabs.querySelectorAll('[title]')) {
              addTooltip(elm, elm.title, true, !elm.classList.contains('helpLink'));
              elm.removeAttribute('title');
            }
          }

          let activeSubTab;
          if (activeSubTab = subTabs.find(tab => tab.classList.contains('active'))) {
            badgeTabGroup = null;
            activeSubTab.click();
          } else {
            updateBadges(game, badgeTabGroup);
          }
        }; // tab.onclick
      }
      badgeGameTabs.replaceChildren(...tabs);
      didUpdateBadgeModal = async () => {
        let activeTab;
        if (activeTab = tabs.find(tab => tab.classList.contains('active'))) {
          badgeTabGame = null; // temporarily set to null to populate subtabs
          activeTab.click();
          await updateBadgeVisibility();
          if (badgeModalContent.dataset.lastScrollTop)
            badgeModalContent.scrollTo(0, +badgeModalContent.dataset.lastScrollTop);
        } else
          await updateBadgeVisibility();
        removeLoader(document.getElementById('badgesModal'));
      };
      await didUpdateBadgeModal();
    });
  };

  /** Updates badge elements based on a `cacheIndex` assigned to them in {@linkcode getBadgeItem} */
  const updateBadgeModalOnly = () => {
    const cacheIndexes = Array.from({ length: badgeFilterCache.length }, (_, i) => i);
    cacheIndexes.sort((a, z) => badgeCompareFunc(badgeFilterCache[a], badgeFilterCache[z]));
    setTimeout(async () => {
      for (let idx = 0; idx < cacheIndexes.length; idx++)
        badgeFilterCache[cacheIndexes[idx]].el.style.order = idx;
      if (!badgeModalContent.childElementCount)
        for (const game in gameBadges)
          for (const group in gameBadges[game])
            badgeModalContent.append(...gameBadges[game][group]);
      await didUpdateBadgeModal?.();
    }, 0);
  };

  let modifyingSlot;
  const onClickBadge = badgeId => {
    if (modifyingSlot) {
      const { slotRow, slotCol } = modifyingSlot;
      updatePlayerBadgeSlot(badgeId, slotRow, slotCol, () => {
        updateBadgeSlots(() => {
          initAccountSettingsModal();
          initBadgeGalleryModal();
          closeModal();
        });
      });
      return;
    }

    updatePlayerBadge(badgeId, () => {
      initAccountSettingsModal();
      closeModal();
    });
  };

  const updateBadgesAndPopulateModal = (slotRow, slotCol) => {
    sortOrder.onchange = () => onChangeBadgeSortOrder(slotRow, slotCol);
    document.getElementById('badgeGalleryButton').classList.toggle('hidden', !!(slotRow && slotCol));

    for (let sot of Object.keys(badgeSortOrderTypes)) {
      const optionAsc = sortOrder.querySelector(`option[value="${sot}"]`);
      const optionDesc = sortOrder.querySelector(`option[value="${sot}_desc"]`);

      optionAsc.innerHTML = getMassagedLabel(localizedMessages.badges.sortOrder.template.replace('{TYPE}', localizedMessages.badges.sortOrder.types[sot]).replace('{ORDER}', localizedMessages.badges.sortOrder.asc));
      optionDesc.innerHTML = getMassagedLabel(localizedMessages.badges.sortOrder.template.replace('{TYPE}', localizedMessages.badges.sortOrder.types[sot]).replace('{ORDER}', localizedMessages.badges.sortOrder.desc));
    }

    fetchAndUpdateBadgeModalBadges(slotRow, slotCol);
  };

  const onChangeBadgeSortOrder = (slotRow, slotCol) => {
    if (!badgeCache?.full)
      addLoader(document.getElementById('badgesModal'), true);
    updateBadgesAndPopulateModal(slotRow, slotCol);
  };

  const onClickBadgeButton = (prevModal, slotRow, slotCol) => {
    if (slotRow && slotCol && (slotRow > badgeSlotRows || slotCol > badgeSlotCols))
      return;

    badgeModalContent.innerHTML = '';

    openModal('badgesModal', null, prevModal || null);
    addLoader(document.getElementById('badgesModal'), true);
    if (!badgeCache.filter(b => !localizedBadges.hasOwnProperty(b.game) || !localizedBadges[b.game].hasOwnProperty(b.badgeId)).length || localizedBadgesIgnoreUpdateTimer)
      updateBadgesAndPopulateModal(slotRow, slotCol);
    else
      updateLocalizedBadges(() => updateBadgesAndPopulateModal(slotRow, slotCol));
  };

  document.getElementById('badgeButton').onclick = () => onClickBadgeButton();
  document.getElementById('accountBadgeButton').onclick = () => onClickBadgeButton('accountSettingsModal');

  let currentSearchMode = 'name';
  const updateBadgeVisibility = (searchMode) => {
    if (typeof searchMode !== 'string')
      searchMode = currentSearchMode;
    else
      currentSearchMode = searchMode;
    const unlockStatus = document.getElementById('badgeUnlockStatus').value;
    const searchTerm = document.getElementById('badgeSearch').value.toLocaleLowerCase();

    const gameVisibilities = {};
    const gameGroupVisibilities = {};

    return new Promise(resolve => window.requestAnimationFrame(() => {
      for (let item of badgeFilterCache) {
        let visible = true;
        if (unlockStatus !== "")
          visible &= item.el.classList.contains('locked') === !parseInt(unlockStatus);
        if (searchTerm.trim().length) {
          switch (searchMode) {
            case 'name':
              visible &= item.title && item.title.indexOf(searchTerm) > -1;
              break;
            case 'location': {
              const localizedLocation = gameLocalizedMapLocations[item.game]?.[item.mapId];
              let title = determineTitle(localizedLocation, item.mapX, item.mapY);
              // TODO: To remove the last condition and allow searching 2kki badges by location from all games,
              // a 2kki-specific cache must be set up and populated from cache and/or queried
              if (!title && item.game === '2kki' && gameId === '2kki') {
                const cacheKey = `0000_${item.mapId}`;
                const cache = locationCache[cacheKey];
                if (Array.isArray(cache)) {
                  const [desc] = cache;
                  title = globalConfig.lang === 'ja' ? desc.titleJP : desc.title;
                }
              }
              visible &= title && title.toLocaleLowerCase().indexOf(searchTerm) > -1;
              break;
            }
          }
        }
        if (!gameVisibilities.hasOwnProperty(item.game)) {
          gameVisibilities[item.game] = false;
          gameGroupVisibilities[item.game] = {};
        }
        if (item.group && !gameGroupVisibilities[item.game].hasOwnProperty(item.group))
          gameGroupVisibilities[item.game][item.group] = false;
        if (visible) {
          if (!gameVisibilities[item.game])
            gameVisibilities[item.game] = true;
          if (item.group && !gameGroupVisibilities[item.game][item.group])
            gameGroupVisibilities[item.game][item.group] = true;
        }
        item.el.classList.toggle('hidden', !visible);
      }

      for (let header of badgeModalContent.querySelectorAll('.itemCategoryHeader'))
        header.classList.toggle('hidden', !(header.dataset.group ? gameGroupVisibilities[header.dataset.game][header.dataset.group] : gameVisibilities[header.dataset.game]));
      resolve();

    }));
  };

  document.getElementById('badgeUnlockStatus').onchange = updateBadgeVisibility;

  const badgeSearch = document.getElementById('badgeSearch');
  const badgeDropdown = document.getElementById('badgeDropdown');
  badgeSearch.oninput = function() {
    badgeDropdown.classList.toggle('hidden', !this.value);
    if (!this.value) {
      searchBadges();
      return;
    }

    for (const span of badgeDropdown.querySelectorAll('.dropdownItem span'))
      span.innerText = this.value;
  };

  badgeSearch.onkeydown = function(ev) {
    if (ev.key !== 'Enter') return;
    searchBadges('name');
  };

  function hideDropdown() {
    setTimeout(() => {
      if (!badgeSearch.parentElement.querySelector('.dropdownItem:focus'))
        badgeDropdown.classList.add('hidden');
    }, 60);
  }
  badgeSearch.onblur = hideDropdown;
  for (const item of badgeSearch.parentElement.querySelectorAll('.dropdownItem'))
    item.onblur = hideDropdown;

  badgeSearch.onfocus = function() {
    this.select();
    if (this.value)
      badgeDropdown.classList.remove('hidden');
  };

  const searchName = document.getElementById('searchName').parentElement;
  searchName.onkeydown = searchName.onclick = function(ev) {
    if (ev.key && ev.key !== 'Enter') return;
    searchBadges('name');
  };

  const searchLocation = document.getElementById('searchLocation').parentElement;
  searchLocation.onkeydown = searchLocation.onclick = function(ev) {
    if (ev.key && ev.key !== 'Enter') return;
    searchBadges('location');
  };

  function searchBadges(mode) {
    badgeDropdown.classList.add('hidden');
    updateBadgeVisibility(mode);
    for (const icon of badgeSearch.parentElement.querySelectorAll('svg.searchIcon'))
      icon.classList.toggle('hidden', !mode || icon.dataset.kind !== mode);
    badgeSearch.classList.toggle('active', !!mode);
  }

  document.getElementById('badgeGalleryButton').onclick = () => {
    updateBadgeSlots(() => {
      initBadgeGalleryModal();
      openModal('badgeGalleryModal');
    });
  };


  let draggedBadge;
  /** @param {DragEvent} ev */
  function didDrag(ev) {
    const dragging = ev.type === 'dragstart';
    this.classList.toggle('dragging', dragging);
    this.draggable = !dragging;
    draggedBadge = dragging ? this : null;
  }

  /** @param {DragEvent} ev */
  function mightDrop(ev) {
    ev.preventDefault();
    if (this.classList.contains('dragging')) return;
    this.classList.toggle('dropTarget', ev.type === 'dragover');
  }

  function didDrop() {
    this.classList.remove('dropTarget');
    const { badgeId, row, col } = this.dataset;
    const { row: srcRow, col: srcCol, badgeId: srcBadgeId } = draggedBadge.dataset;
    updatePlayerBadgeSlot(srcBadgeId, row, col, async () => {
      if (srcBadgeId === 'null')
        await new Promise(resolve => updatePlayerBadgeSlot(badgeId, srcRow, srcCol, resolve));
      // Don't call updateBadgeSlots here, just swap manually.
      badgeSlotCache[+srcRow - 1][+srcCol - 1] = badgeId;
      badgeSlotCache[+row - 1][+col - 1] = srcBadgeId;
      initBadgeGalleryModal();
    });
  }

  /** @param {MouseEvent} ev */
  async function onClickBadgeSlot(ev) {
    let { row, col } = this.dataset;
    row = +row;
    col = +col;
    if (badgeGalleryModalContent.classList.contains('removing') || ev.shiftKey) {
      this.classList.remove('removing');
      await new Promise(resolve => updatePlayerBadgeSlot('null', row, col, resolve));
      badgeSlotCache[row - 1][col - 1] = 'null';
      initBadgeGalleryModal();
      return;
    }

    return onClickBadgeButton('badgeGalleryModal', row, col);
  }

  /** @param {MouseEvent} ev */
  function highlightRemove(ev) {
    if (this.dataset.badgeId === 'null') {
      this.classList.remove('removing');
      return;
    }
    window.requestAnimationFrame(() =>
      this.classList.toggle('removing', ev.shiftKey && ev.type !== 'mouseleave')
    );
  }

  for (let r = 1; r <= maxBadgeSlotRows; r++) {
    const badgeSlotRow = document.createElement('div');
    badgeSlotRow.classList.add('itemRow');
    for (let c = 1; c <= maxBadgeSlotCols; c++) {
      const badgeSlotButton = document.createElement('div');
      badgeSlotButton.classList.add('badgeSlotButton', 'badgeItem', 'item', 'unselectable');
      badgeSlotButton.dataset.row = r;
      badgeSlotButton.dataset.col = c;
      badgeSlotButton.draggable = true;
      badgeSlotButton.onclick = onClickBadgeSlot;
      badgeSlotButton.ondragstart = badgeSlotButton.ondragend = didDrag;
      badgeSlotButton.ondragover = badgeSlotButton.ondragleave = mightDrop;
      badgeSlotButton.ondrop = didDrop;
      badgeSlotButton.onmouseenter = badgeSlotButton.onmousemove = badgeSlotButton.onmouseleave = highlightRemove;
      badgeSlotRow.appendChild(badgeSlotButton);
    }
    badgeGalleryModalContent.appendChild(badgeSlotRow);
  }

  document.getElementById('removeBadgesButton').onclick = function() {
    const removing = badgeGalleryModalContent.classList.toggle('removing');
    this.innerText = removing ? 'Done' : 'Remove Badges';
  };
}

/**
 * Does not take into account the previous map ID.
 *
 * @param {MapDescriptor} descriptor 
 * @returns {string?}
 */
function determineTitle(descriptor, x, y) {
  if (!descriptor || typeof descriptor === 'string') return descriptor;
  if (Array.isArray(descriptor)) {
    const match = descriptor.find(loc => {
      if (typeof loc === 'string') return true;
      if (!loc.coords) return true;
      let pass = true;
      if (typeof x === 'number')
        pass = pass
          && (loc.coords.x1 === -1 || loc.coords.x1 <= x)
          && (loc.coords.x2 === -1 || loc.coords.x2 >= x);
      if (typeof y === 'number')
        pass = pass
          && (loc.coords.y1 === -1 || loc.coords.y1 <= y)
          && (loc.coords.y2 === -1 || loc.coords.y2 >= y);
      return pass;
    });
    return match && determineTitle(match, x, y);
  }
  if ('else' in descriptor) return determineTitle(descriptor.else, x, y);
  return descriptor.title;
}

function initBadgeGalleryModal() {
  const unlockedBadges = badgeCache.filter(b => b.unlocked && !b.hidden);
  const totalBp = unlockedBadges.reduce((sum, b) => sum + b.bp, 0);
  const totalBc = unlockedBadges.length;

  let levelRowBp = 0;
  let prevLevelRowBp = 0;

  for (let rl = 0; rl < badgeGalleryRowBpLevels.length; rl++) {
    const rowBpLevel = badgeGalleryRowBpLevels[rl];
    levelRowBp = Math.max(rowBpLevel.bp - prevLevelRowBp, 0);
    if (totalBp < rowBpLevel.bp)
      break;
    prevLevelRowBp = rowBpLevel.bp;
  }

  let levelColBc = 0;
  let prevLevelColBc = 0;

  for (let cl = 0; cl < badgeGalleryColBcLevels.length; cl++) {
    const colBcLevel = badgeGalleryColBcLevels[cl];
    levelColBc = Math.max(colBcLevel.bc - prevLevelColBc, 0);
    if (totalBc < colBcLevel.bc)
      break;
    prevLevelColBc = colBcLevel.bc;
  }

  const rootStyle = document.documentElement.style;

  rootStyle.setProperty('--row-level-total-bp', levelRowBp);
  rootStyle.setProperty('--row-level-bp', totalBp - prevLevelRowBp);
  document.getElementById('badgeGalleryTotalBp').innerHTML = getMassagedLabel(localizedMessages.badgeGallery.bp.replace('{BP}', totalBp), true);
  rootStyle.setProperty('--col-level-total-bc', levelColBc);
  rootStyle.setProperty('--col-level-bc', totalBc - prevLevelColBc);
  document.getElementById('badgeGalleryTotalBc').innerHTML = getMassagedLabel(localizedMessages.badgeGallery.count.replace('{COUNT}', totalBc), true);

  for (let r = 1; r <= maxBadgeSlotRows; r++) {
    for (let c = 1; c <= maxBadgeSlotCols; c++) {
      const badgeId = r <= badgeSlotCache.length && c <= badgeSlotCache[r - 1].length ? badgeSlotCache[r - 1][c - 1] : null;
      const badgeSlotButton = badgeGalleryModalContent.querySelector(`.badgeSlotButton[data-row='${r}'][data-col='${c}']`);
      if (badgeSlotButton) {
        let badge = badgeId && badgeId !== 'null' ? badgeCache.find(b => b.badgeId === badgeId) : null;
        if (!badge)
          badge = { badgeId: 'null' };
        badgeSlotButton.classList.toggle('hidden', r > badgeSlotRows || c > badgeSlotCols);
        badgeSlotButton.innerHTML = getBadgeItem(badge).innerHTML;
        badgeSlotButton.dataset.badgeId = badge.badgeId;
        if (badge?.overlayType & BadgeOverlayType.LOCATION)
          handleBadgeOverlayLocationColorOverride(badgeSlotButton.querySelector('.badgeOverlay'), badgeSlotButton.querySelector('.badgeOverlay2'), cachedLocations);
      }
    }
  }
}

function updateBadgeButton() {
  const badgeId = playerData?.badge || 'null';
  const badge = playerData?.badge ? badgeCache.find(b => b.badgeId === badgeId) : null;
  const badgeButton = document.getElementById('badgeButton');
  badgeButton.innerHTML = getBadgeItem(badge || { badgeId: 'null' }, false, true).innerHTML;
  if (badge?.overlayType & BadgeOverlayType.LOCATION)
    handleBadgeOverlayLocationColorOverride(badgeButton.querySelector('.badgeOverlay'), badgeButton.querySelector('.badgeOverlay2'), cachedLocations);
}

function getBadgeUrl(badge, staticOnly) {
  let badgeId;
  if (typeof badge === 'string') {
    badgeId = badge;
    badge = badgeId ? badgeCache.find(b => b.badgeId === badgeId) : null;
  } else
    badgeId = badge.badgeId;
  return badgeId ? `images/badge/${badgeId}${!staticOnly && badge?.animated ? '.gif' : '.png'}` : '';
}

/**
  @param {Badge} badge
*/
function getBadgeItem(badge, includeTooltip, emptyIcon, lockedIcon, scaled, filterable, parsedSystemName) {
  const badgeId = badge.badgeId;

  const item = document.createElement('div');
  item.classList.add('badgeItem', 'item', 'unselectable');

  let filterItem;
  if (filterable && badgeId !== 'null') {
    filterItem = {
      el: item,
      title: '',
      mapId: '',
      game: badge.game,
      group: badge.group,
      mapX: badge.mapX,
      mapY: badge.mapY,
      bp: badge.bp,
      percent: badge.percent,
    };
    item.dataset.cacheIndex = badgeFilterCache.push(filterItem) - 1;
  }

  const badgeContainer = document.createElement('div');
  badgeContainer.classList.add('badgeContainer');
  if (badge.hidden && badge.unlocked)
    badgeContainer.classList.add('special');

  const badgeEl = (badge.unlocked || !badge.secret) && badgeId !== 'null' ? document.createElement('div') : null;
  const badgeUrl = badgeEl ? getBadgeUrl(badge, !badge.unlocked) : null;

  if (badgeEl) {
    badgeEl.classList.add('badge');
    if (scaled)
      badgeEl.classList.add('scaledBadge');
    badgeEl.style.backgroundImage = `url('${badgeUrl}')`;

    if (badge.overlayType) {
      badgeEl.classList.add('overlayBadge');

      const badgeOverlay = document.createElement('div');
      badgeOverlay.classList.add('badgeOverlay');
      if (badge.overlayType & BadgeOverlayType.MULTIPLY)
        badgeOverlay.classList.add('badgeOverlayMultiply');

      badgeEl.appendChild(badgeOverlay);

      const badgeMaskValue = badge.overlayType & BadgeOverlayType.MASK
        ? `url('${badgeUrl.replace('.', badge.overlayType & BadgeOverlayType.DUAL ? '_mask_fg.' : '_mask.')}')`
        : badgeEl.style.backgroundImage;

      badgeOverlay.setAttribute('style', `-webkit-mask-image: ${badgeMaskValue}; mask-image: ${badgeMaskValue};`);

      if (badge.overlayType & BadgeOverlayType.DUAL) {
        const badgeMask2Value = badge.overlayType & BadgeOverlayType.MASK
          ? `url(${badgeUrl.replace('.', '_mask_bg.')})`
          : badgeEl.style.backgroundImage;

        badgeOverlay.classList.add('badgeOverlayBase');

        const badgeOverlay2 = document.createElement('div');
        badgeOverlay2.classList.add('badgeOverlay', 'badgeOverlay2');
        if (badge.overlayType & BadgeOverlayType.MULTIPLY)
          badgeOverlay2.classList.add('badgeOverlayMultiply');
        badgeOverlay2.classList.add(getStylePropertyValue('--base-color') !== getStylePropertyValue('--alt-color') ? 'badgeOverlayAlt' : 'badgeOverlayBg');

        badgeEl.appendChild(badgeOverlay2);

        badgeOverlay2.setAttribute('style', `-webkit-mask-image: ${badgeMask2Value}; mask-image: ${badgeMask2Value};`);
      }
    }

    badgeContainer.appendChild(badgeEl);
    if (!badge.unlocked) {
      item.classList.add('locked', 'disabled');
      if (lockedIcon)
        badgeContainer.appendChild(getSvgIcon('locked', true));
    }
  } else if (badgeId !== 'null') {
    item.classList.add('locked', 'disabled');
    if (lockedIcon)
      badgeContainer.appendChild(getSvgIcon('locked', true));
    badgeContainer.appendChild(document.createElement('div'));
  } else
    badgeContainer.appendChild(emptyIcon ? getSvgIcon('ban', true) : document.createElement('div'));

  if (parsedSystemName)
    applyThemeStyles(item, parsedSystemName, badge.game);

  if (includeTooltip) {
    let tooltipContent = '';

    if (badgeId === 'null')
      tooltipContent = `<label>${localizedMessages.badges.null}</label>`;
    else {
      if (localizedBadges.hasOwnProperty(badge.game) && localizedBadges[badge.game].hasOwnProperty(badgeId)) {
        let badgeTitle = localizedMessages.badges.locked;
        const localizedTooltip = localizedBadges[badge.game][badgeId];
        if ((badge.unlocked || !badge.secret) && localizedTooltip.name)
          badgeTitle = getMassagedLabel(localizedTooltip.name);
        if (filterItem)
          filterItem.title = badgeTitle.toLocaleLowerCase();
        if (badge.bp)
          badgeTitle = getMassagedLabel(localizedMessages.badges.badgeTitle).replace('{TITLE}', badgeTitle).replace('{BP}', badge.bp);
        tooltipContent += `<h3 class="tooltipTitle${badge.hidden ? ' altText' : ''}">${badgeTitle}</h3>`;
        if ((badge.unlocked || !badge.secret) && localizedTooltip.description)
          tooltipContent += `<div class="tooltipContent">${getMassagedLabel(localizedTooltip.description)}</div>`;
        tooltipContent += '<div class="tooltipSpacer"></div>';
        if (badge.mapId)
          tooltipContent += `<span class="tooltipLocation"><label>${getMassagedLabel(localizedMessages.badges.location)}</label><span class="tooltipLocationText">{LOCATION}</span></span>`;
        if ((badge.unlocked || !badge.secret) && localizedTooltip.condition) {
          if (badge.unlocked || !badge.secretCondition) {
            let condition = getMassagedLabel(localizedTooltip.condition);
            if (badge.seconds) {
              const minutes = Math.floor(badge.seconds / 60);
              const seconds = badge.seconds - minutes * 60;
              condition = condition.replace('{TIME}', localizedMessages.badges.time.replace('{MINUTES}', minutes.toString().padStart(2, '0')).replace('{SECONDS}', seconds.toString().padStart(2, '0')));
            }
            tooltipContent += `<div class="tooltipContent">${condition}</div>`;
          } else
            tooltipContent += `<h3 class="tooltipTitle">${localizedMessages.badges.locked}</h3>`;
        }
      } else {
        tooltipContent += `<h3 class="tooltipTitle">${localizedMessages.badges.locked}</h3>`;
        if (filterItem)
          filterItem.title = localizedMessages.badges.locked;
      }

      tooltipContent += '<label class="tooltipFooter">';
      if (!badge.secret && !badge.secretCondition && badge.goalsTotal > 1)
        tooltipContent += `${getMassagedLabel(localizedMessages.badges.goalProgress).replace('{CURRENT}', badge.goals).replace('{TOTAL}', badge.goalsTotal)}<br>`;

      // For displaying the percentage, we want to round it down to two digits if < 1, and one otherwise.
      const roundingRatio = badge.percent < 1 ? 100 : 10;
      tooltipContent += `${getMassagedLabel(localizedMessages.badges.percentUnlocked).replace('{PERCENT}', Math.floor(badge.percent * roundingRatio) / roundingRatio)}`;

      if ((badge.unlocked || !badge.secret) && badge.art)
        tooltipContent += `<small class="tooltipCornerText">${getMassagedLabel(localizedMessages.badges.artCredit).replace('{ARTIST}', badge.art)}</small>`

      tooltipContent += '</label>';

      if (tooltipContent) {
        const baseTooltipContent = tooltipContent;
        const tooltipOptions = {};

        const assignTooltip = instance => {
          const systemName = parsedSystemName;
          const assignImmediately = () => {
            const badgeTippy = addOrUpdateTooltip(item, tooltipContent, false, false, !!badge.mapId, tooltipOptions, instance);
            if (systemName)
              applyThemeStyles(badgeTippy.popper.querySelector('.tippy-box'), systemName, badge.game);
          };
          if (includeTooltip === 'lazy')
            assignTooltipCallbacks.set(item, assignImmediately);
          else
            assignImmediately();
        };

        if (badge.mapId) {
          const mapId = badge.mapId.toString().padStart(4, '0');
          if (filterItem) filterItem.mapId = mapId;
          const setTooltipLocation = instance => {
            if (gameLocalizedMapLocations[badge.game] && gameLocalizedMapLocations[badge.game].hasOwnProperty(mapId))
              tooltipContent = baseTooltipContent.replace('{LOCATION}', getLocalizedMapLocationsHtml(badge.game, mapId, '0000', badge.mapX, badge.mapY, getInfoLabel('&nbsp;|&nbsp;')));
            else if (badge.game === '2kki') {
              tooltipContent = baseTooltipContent.replace('{LOCATION}', getInfoLabel(getMassagedLabel(localizedMessages.location.queryingLocation)));
              tooltipOptions.onCreate = instance => getOrQuery2kkiLocationsHtml(mapId, locationsHtml => instance.setContent(baseTooltipContent.replace('{LOCATION}', locationsHtml)));
            } else
              tooltipContent = baseTooltipContent.replace('{LOCATION}', getInfoLabel(getMassagedLabel(localizedMessages.location.unknownLocation)));
            assignTooltip(instance);
          };
          if (gameLocalizedMapLocations.hasOwnProperty(badge.game))
            setTooltipLocation();
          else {
            tooltipContent = baseTooltipContent.replace('{LOCATION}', getInfoLabel(getMassagedLabel(localizedMessages.location.queryingLocation)));
            tooltipOptions.onCreate = instance => {
              includeTooltip = true;
              if (gameLocalizedMapLocations.hasOwnProperty(badge.game))
                setTooltipLocation(instance);
              else
                fetchAndInitLocations(globalConfig.lang, badge.game).then(() => setTooltipLocation(instance));
            };
            assignTooltip();
          }
        } else
          assignTooltip();
      }
    }
  }

  item.appendChild(badgeContainer);

  return item;
}

/**
  @param {(_: BadgeCache) => any} [callback]
*/
function fetchPlayerBadges(callback) {
  if (badgeCache?.full) {
    callback?.(badgeCache);
    return;
  }
  apiFetch('badge?command=list')
    .then(response => {
      if (!response.ok)
        throw new Error(response.statusText);
      return response.json();
    })
    .then(badges => {
      for (const { badgeId, newUnlock } of badges)
        if (newUnlock)
          showBadgeToastMessage('badgeUnlocked', 'info', badgeId);
      badgeCache = badges;
      badgeCache.full = true;
      callback?.(badgeCache);
    })
    .catch(err => console.error(err));
}

function updateBadges(callback) {
  apiFetch('badge?command=list&simple=true')
    .then(response => {
      if (!response.ok)
        throw new Error(response.statusText);
      return response.json();
    })
    .then(badges => {
      for (const { badgeId, newUnlock } of badges)
        if (newUnlock)
          showBadgeToastMessage('badgeUnlocked', 'info', badgeId);
      badgeCache = badges;

      if (badgeCacheUpdateTimer)
        clearInterval(badgeCacheUpdateTimer);
      badgeCacheUpdateTimer = setInterval(updateBadges, 900000);

      if (callback)
        callback();
    })
    .catch(err => console.error(err));
}

function updateBadgeSlots(callback) {
  apiFetch('badge?command=slotList')
    .then(response => {
      if (!response.ok)
        throw new Error(response.statusText);
      return response.json();
    })
    .then(badgeSlots => {
      badgeSlotCache = badgeSlots || [];
      if (callback)
        callback();
    })
    .catch(err => console.error(err));
}

function updatePlayerBadge(badgeId, callback) {
  apiFetch(`badge?command=set&id=${badgeId}`)
    .then(response => {
      if (!response.ok)
        throw new Error(response.statusText);
      syncPlayerData(playerUuids[-1], playerData?.rank, playerData?.account, badgeId, playerData?.medals, -1);
      if (callback)
        callback();
    })
    .catch(err => console.error(err));
}

function updatePlayerBadgeSlot(badgeId, slotRow, slotCol, callback) {
  apiFetch(`badge?command=slotSet&id=${badgeId}&row=${slotRow}&col=${slotCol}`)
    .then(response => {
      if (!response.ok)
        throw new Error(response.statusText);
      if (callback)
        callback();
    })
    .catch(err => console.error(err));
}

function checkNewBadgeUnlocks() {
  apiFetch('badge?command=new')
    .then(response => {
      if (!response.ok)
        throw new Error(response.statusText);
      return response.json();
    })
    .then(unlockedBadgeIds => {
      if (unlockedBadgeIds) {
        if (badgeCache) {
          badgeCache.full = false;
        }
        
        for (const badgeId of unlockedBadgeIds)
          showBadgeToastMessage('badgeUnlocked', 'info', badgeId);
      }
    })
    .catch(err => console.error(err));
}

function updateLocalizedBadgeGroups(callback) {
  fetch(`lang/badge/groups/${globalConfig.lang}.json`)
    .then(response => response.json())
    .then(function(jsonResponse) {
      localizedBadgeGroups = jsonResponse;
      if (callback)
        callback(true);
    })
    .catch(err => console.error(err));
}

function updateLocalizedBadges(callback) {
  if (localizedBadgesIgnoreUpdateTimer)
    clearInterval(localizedBadgesIgnoreUpdateTimer);

  fetchNewest(`lang/badge/${globalConfig.lang}.json`)
    .then(response => response.json())
    .then(function(jsonResponse) {
      localizedBadges = jsonResponse;
      localizedBadgesIgnoreUpdateTimer = setTimeout(() => localizedBadgesIgnoreUpdateTimer = null, 300000);
      if (callback)
        callback(true);
    })
    .catch(err => console.error(err));
}

function addOrUpdatePlayerBadgeGalleryTooltip(badgeElement, name, sysName, mapId, prevMapId, prevLocationsStr, x, y) {
  badgeElement.dataset.playerName = name;
  badgeElement.dataset.systemName = sysName;

  if (!badgeElement._badgeGalleryTippy) {
    badgeElement._badgeGalleryTippy = tippy(badgeElement, Object.assign({
      trigger: 'click',
      interactive: true,
      content: `<div class="tooltipContent">${getMassagedLabel(localizedMessages.badgeGallery.loading, true)}</div>`,
      appendTo: document.getElementById('layout'),
      onShow: instance => {
        const playerName = instance.reference.dataset.playerName;
        const systemName = instance.reference.dataset.systemName;

        apiFetch(`badge?command=playerSlotList&player=${playerName}`)
          .then(response => {
            if (!response.ok)
              throw new Error(response.statusText);
            return response.json();
          })
          .then(badgeSlots => {
            if (!badgeSlots || !badgeSlots.flat().filter(b => b !== 'null').length) {
              instance.hide();
              return;
            }

            let minRowIndex = badgeSlots.length - 1;
            let maxRowIndex = 0;
            let minColIndex = badgeSlots[0].length - 1;
            let maxColIndex = 0;

            badgeSlots.forEach((badgeRowSlots, r) => {
              let rowHasBadge = false;
              badgeRowSlots.forEach((badgeId, c) => {
                if (badgeId === 'null')
                  return;
                rowHasBadge = true;
                if (c < minColIndex)
                  minColIndex = c;
                if (c > maxColIndex)
                  maxColIndex = c;
              });
              if (rowHasBadge) {
                if (r < minRowIndex)
                  minRowIndex = r;
                if (r > maxRowIndex)
                  maxRowIndex = r;
              }
            });

            const tooltipContent = document.createElement('div');
            tooltipContent.classList.add('tooltipContent', 'noShadow');

            const tooltipTitle = document.createElement('h4');
            tooltipTitle.classList.add('tooltipTitle');
            tooltipTitle.innerHTML = getMassagedLabel(localizedMessages.badgeGallery.label, true).replace('{PLAYER}', playerName);

            const badgeSlotRowsContainer = document.createElement('div');
            badgeSlotRowsContainer.classList.add('badgeSlotRowsContainer');

            badgeSlots.forEach((badgeRowSlots, r) => {
              if (r < minRowIndex || r > maxRowIndex)
                return;

              const badgeSlotRow = document.createElement('div');
              badgeSlotRow.classList.add('badgeSlotRow');

              badgeRowSlots.forEach((badgeId, c) => {
                if (c < minColIndex || c > maxColIndex)
                  return;

                const badgeSlot = document.createElement('div');
                badgeSlot.classList.add('badgeSlot', 'badge');
                badgeSlot.dataset.rowIndex = r;
                badgeSlot.dataset.colIndex = c;

                if (badgeId !== 'null') {
                  const badgeUrl = getBadgeUrl(badgeId);

                  badgeSlot.style.backgroundImage = `url('${badgeUrl}')`;

                  const badge = badgeCache.find(b => b.badgeId === badgeId);

                  if (badge?.overlayType) {
                    const badgeSlotOverlay = document.createElement('div');

                    badgeSlotOverlay.classList.add('badgeSlotOverlay', 'badgeOverlay');
                    if (badge.overlayType & BadgeOverlayType.MULTIPLY)
                      badgeSlotOverlay.classList.add('badgeOverlayMultiply');
                    badgeSlotOverlay.dataset.overlayType = badge.overlayType;

                    badgeSlot.appendChild(badgeSlotOverlay);

                    const badgeMaskUrl = badge.overlayType & BadgeOverlayType.MASK
                      ? badgeUrl.replace('.', badge.overlayType & BadgeOverlayType.DUAL ? '_mask_fg.' : '_mask.')
                      : badgeUrl;

                    badgeSlotOverlay.setAttribute('style', `-webkit-mask-image: url('${badgeMaskUrl}'); mask-image: url('${badgeMaskUrl}');`);

                    if (badge.overlayType & BadgeOverlayType.DUAL) {
                      const badgeSlotOverlay2 = document.createElement('div');

                      badgeSlotOverlay2.classList.add('badgeOverlay', 'badgeOverlay2');
                      if (badge.overlayType & BadgeOverlayType.MULTIPLY)
                        badgeSlotOverlay2.classList.add('badgeOverlayMultiply');

                      badgeSlot.appendChild(badgeSlotOverlay2);

                      const badgeMask2Url = badge.overlayType & BadgeOverlayType.MASK
                        ? badgeUrl.replace('.', '_mask_bg.')
                        : badgeUrl;

                      badgeSlotOverlay2.setAttribute('style', `-webkit-mask-image: url('${badgeMask2Url}'); mask-image: url('${badgeMask2Url}');`);
                    }
                  }
                }

                badgeSlotRow.appendChild(badgeSlot);
              });

              badgeSlotRowsContainer.appendChild(badgeSlotRow);
            });

            const tippyBox = instance.popper.children[0];

            const parsedSystemName = systemName ? (gameUiThemes.indexOf(systemName) > -1 ? systemName : getDefaultUiTheme()).replace(/ /g, '_') : null;

            if (parsedSystemName)
              applyThemeStyles(tippyBox, parsedSystemName);

            tooltipContent.appendChild(tooltipTitle);
            tooltipContent.appendChild(badgeSlotRowsContainer);

            instance.setContent(tooltipContent.outerHTML);

            if (parsedSystemName) {
              const badgeSlotOverlays = tippyBox.querySelectorAll('.badgeSlotOverlay');
              for (let badgeSlotOverlay of badgeSlotOverlays) {
                const overlayType = parseInt(badgeSlotOverlay.dataset.overlayType);
                badgeSlotOverlay.style.background = overlayType & BadgeOverlayType.GRADIENT
                  ? `var(--base-gradient-${parsedSystemName})`
                  : `rgb(var(--base-color-${parsedSystemName}))`;

                const badgeSlotOverlay2 = overlayType & BadgeOverlayType.DUAL ? badgeSlotOverlay.parentElement.querySelector('.badgeOverlay2') : null;

                if (badgeSlotOverlay2) {
                  if (getStylePropertyValue(`--base-color-${parsedSystemName}`) !== getStylePropertyValue(`--alt-color-${parsedSystemName}`)) {
                    badgeSlotOverlay2.style.background = overlayType & BadgeOverlayType.GRADIENT
                      ? `var(--alt-gradient-${parsedSystemName})`
                      : `rgb(var(--alt-color-${parsedSystemName}))`;
                  } else
                    badgeSlotOverlay2.style.background = `rgb(var(--base-bg-color-${parsedSystemName}))`
                }

                if (overlayType & BadgeOverlayType.LOCATION)
                  handleBadgeOverlayLocationColorOverride(badgeSlotOverlay, badgeSlotOverlay2, null, playerName, mapId, prevMapId, prevLocationsStr, x, y);
              }
            }

            if (localizedBadges) {
              const badges = instance.popper.querySelectorAll('.badge');
              for (let badge of badges) {
                const badgeId = badgeSlots[badge.dataset.rowIndex][badge.dataset.colIndex];
                if (badgeId === 'null')
                  continue;
                const badgeGame = Object.keys(localizedBadges).find(game => {
                  return Object.keys(localizedBadges[game]).find(b => b === badgeId);
                });
                if (badgeGame) {
                  const badgeTippy = addTooltip(badge, getMassagedLabel(localizedBadges[badgeGame][badgeId].name, true), true, false, true);
                  applyThemeStyles(badgeTippy.popper.querySelector('.tippy-box'), parsedSystemName);
                  if (badgeCache.find(b => b.badgeId === badgeId)?.hidden)
                    badgeTippy.popper.querySelector('.tooltipContent').classList.add('altText');
                }
              }
            }
          })
          .catch(err => {
            console.error(err);
            instance.setContent('');
          });
      }
    }, tippyConfig));
  }

  return badgeElement._badgeGalleryTippy;
}

// EXTERNAL
function onBadgeUpdateRequested() {
  if (loginToken)
    checkNewBadgeUnlocks();
}

function showBadgeToastMessage(key, icon, badgeId) {
  if (!notificationConfig.badges.all || (notificationConfig.badges.hasOwnProperty(key) && !notificationConfig.badges[key]))
    return;
  const message = getMassagedLabel(localizedMessages.toast.badges[key], true);
  const toast = showToastMessage(message, icon, true, null, !!badgeId);

  if (badgeId) {
    const badgeObj = badgeCache.find(b => b.badgeId === badgeId);

    if (badgeObj) {
      const badgeEl = getBadgeItem(badgeObj).querySelector('.badgeContainer');

      toast.querySelector('.icon').remove();
      toast.prepend(badgeEl);

      addTooltip(badgeEl, localizedBadges[badgeObj.game][badgeId].name, true, true);
    }
  }
}
