/* ==========================================================================
   Comics Browser - Main Application (ES5, Kindle-compatible)
   ==========================================================================
   - No ES6+ features (no arrow functions, const/let, template literals, etc.)
   - Uses XMLHttpRequest (not fetch)
   - Hash-based routing
   - localStorage for favourites and reading position
   ========================================================================== */

(function () {
  'use strict';

  // =========================================================================
  // Configuration
  // =========================================================================

  var SOURCES = {
    xkcd: {
      id: 'xkcd',
      name: 'xkcd',
      description: 'Science, math, language, and romance by Randall Munroe',
      tags: ['science', 'math', 'technology', 'philosophy', 'wordplay'],
      dataFile: 'data/xkcd-latest.json',
      archiveFile: 'data/xkcd-archive.json',
      hasArchive: true,
      hasNumbers: true,
      color: '#000'
    },
    dinosaur: {
      id: 'dinosaur',
      name: 'Dinosaur Comics',
      description: 'Philosophical dinosaurs discuss life, language, and the universe by Ryan North',
      tags: ['philosophy', 'linguistics', 'absurd', 'dinosaurs', 'science'],
      dataFile: 'data/dinosaur-latest.json',
      archiveFile: 'data/dinosaur-archive.json',
      hasArchive: true,
      hasNumbers: true,
      color: '#000'
    },
    smbc: {
      id: 'smbc',
      name: 'SMBC',
      description: 'Saturday Morning Breakfast Cereal - science and philosophy by Zach Weinersmith',
      tags: ['science', 'philosophy', 'religion', 'math', 'satire'],
      dataFile: 'data/smbc-latest.json',
      archiveFile: null,
      hasArchive: false,
      hasNumbers: false,
      color: '#000'
    },
    wondermark: {
      id: 'wondermark',
      name: 'Wondermark',
      description: 'Absurdist Victorian-era collage comics by David Malki!',
      tags: ['absurd', 'wordplay', 'victorian', 'dry-wit'],
      dataFile: 'data/wondermark-latest.json',
      archiveFile: null,
      hasArchive: false,
      hasNumbers: false,
      color: '#000'
    },
    nedroid: {
      id: 'nedroid',
      name: 'Nedroid',
      description: 'Surreal, silly adventures of Beartato and Reginald by Anthony Clark',
      tags: ['absurd', 'silly', 'wholesome', 'surreal'],
      dataFile: 'data/nedroid-latest.json',
      archiveFile: null,
      hasArchive: false,
      hasNumbers: false,
      color: '#000'
    }
  };

  var SOURCE_ORDER = ['xkcd', 'dinosaur', 'smbc', 'wondermark', 'nedroid'];

  var ARCHIVE_PAGE_SIZE = 20;

  // Recommendation map: "if you like X, try Y because Z"
  var RECOMMENDATIONS = {
    xkcd: [
      { source: 'smbc', reason: 'Also explores science and philosophy through humour' },
      { source: 'dinosaur', reason: 'Philosophical discussions with a playful twist' },
      { source: 'wondermark', reason: 'Clever wordplay and unexpected punchlines' }
    ],
    dinosaur: [
      { source: 'xkcd', reason: 'Science and philosophy with a nerdy edge' },
      { source: 'smbc', reason: 'Deep philosophical questions played for laughs' },
      { source: 'nedroid', reason: 'Absurd character-driven humour' }
    ],
    smbc: [
      { source: 'xkcd', reason: 'Science and math jokes with hidden depth' },
      { source: 'dinosaur', reason: 'Philosophical rambling by enthusiastic characters' },
      { source: 'wondermark', reason: 'Dry wit and unexpected absurdist twists' }
    ],
    wondermark: [
      { source: 'nedroid', reason: 'Absurd humour with loveable characters' },
      { source: 'dinosaur', reason: 'Absurdist philosophical comedy' },
      { source: 'smbc', reason: 'Clever setups with surprising punchlines' }
    ],
    nedroid: [
      { source: 'wondermark', reason: 'Surreal and absurd, with great dry wit' },
      { source: 'dinosaur', reason: 'Silly philosophical adventures' },
      { source: 'xkcd', reason: 'Clever and surprising with hidden jokes' }
    ]
  };

  // =========================================================================
  // State
  // =========================================================================

  var cache = {};       // Cached JSON data keyed by URL
  var currentRoute = null;
  var app = document.getElementById('app');
  var headerTitle = document.getElementById('header-title');
  var headerBack = document.getElementById('header-back');
  var headerFav = document.getElementById('header-fav');

  // =========================================================================
  // localStorage helpers (graceful failure)
  // =========================================================================

  function storageGet(key) {
    try {
      var val = localStorage.getItem('comics_' + key);
      return val ? JSON.parse(val) : null;
    } catch (e) {
      return null;
    }
  }

  function storageSet(key, val) {
    try {
      localStorage.setItem('comics_' + key, JSON.stringify(val));
    } catch (e) {
      // silently fail
    }
  }

  // Favourites: stored as array of { source, id, title }
  function getFavourites() {
    return storageGet('favourites') || [];
  }

  function saveFavourites(favs) {
    storageSet('favourites', favs);
  }

  function isFavourite(source, id) {
    var favs = getFavourites();
    for (var i = 0; i < favs.length; i++) {
      if (favs[i].source === source && favs[i].id === id) return true;
    }
    return false;
  }

  function toggleFavourite(source, id, title) {
    var favs = getFavourites();
    var found = -1;
    for (var i = 0; i < favs.length; i++) {
      if (favs[i].source === source && favs[i].id === id) {
        found = i;
        break;
      }
    }
    if (found >= 0) {
      favs.splice(found, 1);
    } else {
      favs.push({ source: source, id: id, title: title });
    }
    saveFavourites(favs);
    return found < 0; // returns true if now favourited
  }

  // Reading position: { source: index }
  function getReadingPosition(source) {
    var positions = storageGet('positions') || {};
    return positions[source] || null;
  }

  function saveReadingPosition(source, comicId) {
    var positions = storageGet('positions') || {};
    positions[source] = comicId;
    storageSet('positions', positions);
  }

  // =========================================================================
  // Data loading (XMLHttpRequest for Kindle compatibility)
  // =========================================================================

  function loadJSON(url, callback) {
    if (cache[url]) {
      return callback(null, cache[url]);
    }

    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      if (xhr.status === 200) {
        try {
          var data = JSON.parse(xhr.responseText);
          cache[url] = data;
          callback(null, data);
        } catch (e) {
          callback(new Error('Failed to parse ' + url));
        }
      } else {
        callback(new Error('Failed to load ' + url + ' (' + xhr.status + ')'));
      }
    };
    xhr.send();
  }

  // =========================================================================
  // Rendering helpers
  // =========================================================================

  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    if (attrs) {
      for (var key in attrs) {
        if (attrs.hasOwnProperty(key)) {
          if (key === 'className') {
            el.className = attrs[key];
          } else if (key.indexOf('on') === 0) {
            el.addEventListener(key.substring(2).toLowerCase(), attrs[key]);
          } else {
            el.setAttribute(key, attrs[key]);
          }
        }
      }
    }
    if (children !== undefined && children !== null) {
      if (typeof children === 'string') {
        el.textContent = children;
      } else if (Array.isArray(children)) {
        for (var i = 0; i < children.length; i++) {
          if (children[i]) {
            if (typeof children[i] === 'string') {
              el.appendChild(document.createTextNode(children[i]));
            } else {
              el.appendChild(children[i]);
            }
          }
        }
      } else {
        el.appendChild(children);
      }
    }
    return el;
  }

  function render(content) {
    app.innerHTML = '';
    if (typeof content === 'string') {
      app.innerHTML = content;
    } else {
      app.appendChild(content);
    }
    // Scroll to top
    window.scrollTo(0, 0);
  }

  function showLoading(message) {
    render(h('div', { className: 'loading' }, message || 'Loading...'));
  }

  function showError(message) {
    render(h('div', { className: 'error' }, message || 'Something went wrong.'));
  }

  // Tap feedback helper
  function addTapFeedback(el) {
    el.addEventListener('touchstart', function () {
      el.className = el.className + ' tap-active';
    });
    el.addEventListener('touchend', function () {
      setTimeout(function () {
        el.className = el.className.replace(/ ?tap-active/g, '');
      }, 150);
    });
  }

  // =========================================================================
  // Screens
  // =========================================================================

  // ---- Home Screen --------------------------------------------------------

  function renderHome() {
    headerTitle.textContent = 'Comics';
    headerBack.style.display = 'none';
    headerFav.style.display = 'inline';
    setActiveNav('home');

    var container = h('div', null, []);

    SOURCE_ORDER.forEach(function (sourceId) {
      var src = SOURCES[sourceId];
      var card = h('div', { className: 'source-card', 'data-source': sourceId }, [
        h('span', { className: 'source-card-name' }, src.name),
        h('span', { className: 'source-card-desc' }, src.description),
        h('span', { className: 'source-card-count' }, src.tags.join(' \u00B7 '))
      ]);

      addTapFeedback(card);
      card.addEventListener('touchend', function (e) {
        e.preventDefault();
        navigate('comic/' + sourceId + '/latest');
      });
      card.addEventListener('click', function (e) {
        e.preventDefault();
        navigate('comic/' + sourceId + '/latest');
      });

      container.appendChild(card);
    });

    render(container);
  }

  // ---- Comic Reader -------------------------------------------------------

  function renderComicReader(sourceId, comicIndex, fromArchive) {
    var src = SOURCES[sourceId];
    if (!src) return showError('Unknown comic source.');

    headerTitle.textContent = src.name;
    headerBack.style.display = 'inline';
    setActiveNav(null);

    var dataFile = fromArchive ? src.archiveFile : src.dataFile;
    if (!dataFile) dataFile = src.dataFile;

    showLoading('Loading ' + src.name + '...');

    loadJSON(dataFile, function (err, data) {
      if (err) return showError('Could not load comics. Are you online?');

      var comics = data.comics || [];
      if (comics.length === 0) return showError('No comics available.');

      // Determine which comic to show
      var idx;
      if (comicIndex === 'latest') {
        idx = 0;
      } else {
        idx = parseInt(comicIndex, 10);
        if (isNaN(idx) || idx < 0) idx = 0;
        if (idx >= comics.length) idx = comics.length - 1;
      }

      var comic = comics[idx];
      if (!comic) return showError('Comic not found.');

      // Save reading position
      var comicId = comic.num !== undefined ? String(comic.num) : (comic.slug || String(idx));
      saveReadingPosition(sourceId, comicId);

      // Build the view
      var container = h('div', { className: 'comic-view' }, []);

      // Image
      var imgWrap = h('div', { className: 'comic-img-wrap' }, []);
      var img = h('img', {
        src: comic.img,
        alt: comic.title || 'Comic',
        width: '100%'
      });
      imgWrap.appendChild(img);
      container.appendChild(imgWrap);

      // Title
      var titleText = comic.title || '';
      if (comic.num !== undefined) {
        titleText = '#' + comic.num + ': ' + titleText;
      }
      container.appendChild(h('div', { className: 'comic-title' }, titleText));

      // Meta
      var metaParts = [src.name];
      if (comic.date) metaParts.push(comic.date);
      container.appendChild(h('div', { className: 'comic-meta' }, metaParts.join(' \u2014 ')));

      // Alt text (tap to reveal)
      if (comic.alt) {
        var altHint = h('div', { className: 'comic-alt-hint' }, 'Tap image for hidden text');
        var altBox = h('div', { className: 'comic-alt' }, comic.alt);

        container.appendChild(altHint);
        container.appendChild(altBox);

        // Tap image to toggle alt text
        var altVisible = false;
        function toggleAlt(e) {
          e.preventDefault();
          altVisible = !altVisible;
          altBox.className = altVisible ? 'comic-alt visible' : 'comic-alt';
          altHint.textContent = altVisible ? 'Tap image to hide' : 'Tap image for hidden text';
        }
        imgWrap.addEventListener('touchend', toggleAlt);
        imgWrap.addEventListener('click', toggleAlt);
      }

      // Favourite button
      var favId = comicId;
      var isFav = isFavourite(sourceId, favId);
      var favBtn = h('div', {
        className: 'comic-fav-btn' + (isFav ? ' is-fav' : '')
      }, isFav ? '\u2605 Favourited' : '\u2606 Add to Favourites');

      favBtn.addEventListener('touchend', function (e) {
        e.preventDefault();
        var nowFav = toggleFavourite(sourceId, favId, comic.title || 'Untitled');
        favBtn.className = 'comic-fav-btn' + (nowFav ? ' is-fav' : '');
        favBtn.textContent = nowFav ? '\u2605 Favourited' : '\u2606 Add to Favourites';
      });
      favBtn.addEventListener('click', function (e) {
        e.preventDefault();
        var nowFav = toggleFavourite(sourceId, favId, comic.title || 'Untitled');
        favBtn.className = 'comic-fav-btn' + (nowFav ? ' is-fav' : '');
        favBtn.textContent = nowFav ? '\u2605 Favourited' : '\u2606 Add to Favourites';
      });
      addTapFeedback(favBtn);
      container.appendChild(favBtn);

      // Prev / Next navigation
      var navRow = h('div', { className: 'comic-nav' }, []);

      // Previous (newer for latest view, lower index)
      var prevBtn = h('div', {
        className: 'comic-nav-btn' + (idx <= 0 ? ' disabled' : '')
      }, '\u25C4 Prev');
      if (idx > 0) {
        addTapFeedback(prevBtn);
        prevBtn.addEventListener('touchend', function (e) {
          e.preventDefault();
          navigate('comic/' + sourceId + '/' + (idx - 1) + (fromArchive ? '/archive' : ''));
        });
        prevBtn.addEventListener('click', function (e) {
          e.preventDefault();
          navigate('comic/' + sourceId + '/' + (idx - 1) + (fromArchive ? '/archive' : ''));
        });
      }
      navRow.appendChild(prevBtn);

      var nextBtn = h('div', {
        className: 'comic-nav-btn' + (idx >= comics.length - 1 ? ' disabled' : '')
      }, 'Next \u25BA');
      if (idx < comics.length - 1) {
        addTapFeedback(nextBtn);
        nextBtn.addEventListener('touchend', function (e) {
          e.preventDefault();
          navigate('comic/' + sourceId + '/' + (idx + 1) + (fromArchive ? '/archive' : ''));
        });
        nextBtn.addEventListener('click', function (e) {
          e.preventDefault();
          navigate('comic/' + sourceId + '/' + (idx + 1) + (fromArchive ? '/archive' : ''));
        });
      }
      navRow.appendChild(nextBtn);
      container.appendChild(navRow);

      // Archive link (if available)
      if (src.hasArchive) {
        var archiveLink = h('div', {
          className: 'comic-nav-btn',
          style: 'width: 94%; margin-bottom: 0.5rem;'
        }, 'Browse Archive');
        addTapFeedback(archiveLink);
        archiveLink.addEventListener('touchend', function (e) {
          e.preventDefault();
          navigate('archive/' + sourceId + '/0');
        });
        archiveLink.addEventListener('click', function (e) {
          e.preventDefault();
          navigate('archive/' + sourceId + '/0');
        });
        container.appendChild(archiveLink);
      }

      // Source attribution
      if (data.attribution) {
        container.appendChild(h('div', { className: 'comic-meta text-center mb-half' }, data.attribution));
      }
      if (data.url) {
        var sourceLink = h('a', { href: data.url, target: '_blank' }, 'Visit ' + src.name);
        var linkWrap = h('div', { className: 'text-center mb-half' }, [sourceLink]);
        container.appendChild(linkWrap);
      }

      render(container);
    });
  }

  // ---- Archive Browser ----------------------------------------------------

  function renderArchive(sourceId, page) {
    var src = SOURCES[sourceId];
    if (!src || !src.archiveFile) return showError('No archive available.');

    headerTitle.textContent = src.name + ' Archive';
    headerBack.style.display = 'inline';
    setActiveNav(null);

    showLoading('Loading archive...');

    loadJSON(src.archiveFile, function (err, data) {
      if (err) return showError('Could not load archive.');

      var comics = data.comics || [];
      if (comics.length === 0) return showError('Archive is empty. It may need to be built first.');

      // Reverse so newest is first in the list
      var reversed = comics.slice().reverse();

      var totalPages = Math.ceil(reversed.length / ARCHIVE_PAGE_SIZE);
      var pageNum = parseInt(page, 10) || 0;
      if (pageNum < 0) pageNum = 0;
      if (pageNum >= totalPages) pageNum = totalPages - 1;

      var start = pageNum * ARCHIVE_PAGE_SIZE;
      var pageComics = reversed.slice(start, start + ARCHIVE_PAGE_SIZE);

      var container = h('div', null, []);

      // Page info
      container.appendChild(h('div', { className: 'text-center mb-half' },
        'Page ' + (pageNum + 1) + ' of ' + totalPages + ' (' + comics.length + ' comics)'));

      // Top pager
      container.appendChild(buildPager(sourceId, pageNum, totalPages));

      // Comic list
      var list = h('ul', { className: 'archive-list' }, []);
      pageComics.forEach(function (comic) {
        // Find the index in the original (non-reversed) array for navigation
        var origIdx = comics.length - 1 - (start + pageComics.indexOf(comic));

        var item = h('li', { className: 'archive-item' }, [
          h('span', { className: 'archive-item-num' }, comic.num !== undefined ? '#' + comic.num : ''),
          h('span', { className: 'archive-item-title' }, comic.title || 'Untitled'),
          h('span', { className: 'archive-item-date' }, comic.date || '')
        ]);

        addTapFeedback(item);
        (function (i) {
          item.addEventListener('touchend', function (e) {
            e.preventDefault();
            navigate('comic/' + sourceId + '/' + i + '/archive');
          });
          item.addEventListener('click', function (e) {
            e.preventDefault();
            navigate('comic/' + sourceId + '/' + i + '/archive');
          });
        })(origIdx);

        list.appendChild(item);
      });
      container.appendChild(list);

      // Bottom pager
      container.appendChild(buildPager(sourceId, pageNum, totalPages));

      render(container);
    });
  }

  function buildPager(sourceId, pageNum, totalPages) {
    var pager = h('div', { className: 'archive-pager' }, []);

    var prevBtn = h('div', {
      className: 'archive-pager-btn' + (pageNum <= 0 ? ' disabled' : '')
    }, '\u25C4 Newer');
    if (pageNum > 0) {
      addTapFeedback(prevBtn);
      prevBtn.addEventListener('touchend', function (e) {
        e.preventDefault();
        navigate('archive/' + sourceId + '/' + (pageNum - 1));
      });
      prevBtn.addEventListener('click', function (e) {
        e.preventDefault();
        navigate('archive/' + sourceId + '/' + (pageNum - 1));
      });
    }
    pager.appendChild(prevBtn);

    var nextBtn = h('div', {
      className: 'archive-pager-btn' + (pageNum >= totalPages - 1 ? ' disabled' : '')
    }, 'Older \u25BA');
    if (pageNum < totalPages - 1) {
      addTapFeedback(nextBtn);
      nextBtn.addEventListener('touchend', function (e) {
        e.preventDefault();
        navigate('archive/' + sourceId + '/' + (pageNum + 1));
      });
      nextBtn.addEventListener('click', function (e) {
        e.preventDefault();
        navigate('archive/' + sourceId + '/' + (pageNum + 1));
      });
    }
    pager.appendChild(nextBtn);

    return pager;
  }

  // ---- Random Comic -------------------------------------------------------

  function renderRandom() {
    headerTitle.textContent = 'Random Comic';
    headerBack.style.display = 'none';
    setActiveNav('random');

    // Pick a random source
    var sourceKeys = SOURCE_ORDER.slice();
    var randomSource = sourceKeys[Math.floor(Math.random() * sourceKeys.length)];
    var src = SOURCES[randomSource];

    showLoading('Finding a random comic...');

    // Try archive first, fall back to latest
    var dataFile = src.archiveFile || src.dataFile;
    loadJSON(dataFile, function (err, data) {
      if (err) {
        // Fall back to latest data
        loadJSON(src.dataFile, function (err2, data2) {
          if (err2) return showError('Could not load comics.');
          pickRandom(randomSource, data2);
        });
        return;
      }
      pickRandom(randomSource, data);
    });
  }

  function pickRandom(sourceId, data) {
    var comics = data.comics || [];
    if (comics.length === 0) return showError('No comics available.');

    var idx = Math.floor(Math.random() * comics.length);
    var src = SOURCES[sourceId];
    var isArchive = data.source === sourceId && src.archiveFile && data.total;

    navigate('comic/' + sourceId + '/' + idx + (isArchive ? '/archive' : ''));
  }

  // ---- Discover / Recommendations -----------------------------------------

  function renderDiscover() {
    headerTitle.textContent = 'Discover';
    headerBack.style.display = 'none';
    setActiveNav('discover');

    var container = h('div', null, []);

    container.appendChild(h('div', { className: 'discover-heading' },
      'Comics in your collection'));

    SOURCE_ORDER.forEach(function (sourceId) {
      var src = SOURCES[sourceId];
      var card = h('div', { className: 'discover-item' }, [
        h('span', { className: 'discover-item-name' }, src.name),
        h('span', { className: 'discover-item-reason' }, src.tags.join(' \u00B7 '))
      ]);
      addTapFeedback(card);
      card.addEventListener('touchend', function (e) {
        e.preventDefault();
        navigate('comic/' + sourceId + '/latest');
      });
      card.addEventListener('click', function (e) {
        e.preventDefault();
        navigate('comic/' + sourceId + '/latest');
      });
      container.appendChild(card);
    });

    // Show recommendations based on last-read comic
    container.appendChild(h('div', {
      className: 'discover-heading',
      style: 'margin-top: 1rem;'
    }, 'If you like...'));

    SOURCE_ORDER.forEach(function (sourceId) {
      var src = SOURCES[sourceId];
      var recs = RECOMMENDATIONS[sourceId];
      if (!recs) return;

      container.appendChild(h('div', {
        style: 'font-weight: bold; margin-top: 0.75rem; margin-bottom: 0.25rem;'
      }, src.name + ':'));

      recs.forEach(function (rec) {
        var recSrc = SOURCES[rec.source];
        if (!recSrc) return;

        var item = h('div', { className: 'discover-item' }, [
          h('span', { className: 'discover-item-name' }, 'Try ' + recSrc.name),
          h('span', { className: 'discover-item-reason' }, rec.reason)
        ]);
        addTapFeedback(item);
        item.addEventListener('touchend', function (e) {
          e.preventDefault();
          navigate('comic/' + rec.source + '/latest');
        });
        item.addEventListener('click', function (e) {
          e.preventDefault();
          navigate('comic/' + rec.source + '/latest');
        });
        container.appendChild(item);
      });
    });

    render(container);
  }

  // ---- Favourites ---------------------------------------------------------

  function renderFavourites() {
    headerTitle.textContent = 'Favourites';
    headerBack.style.display = 'none';
    headerFav.style.display = 'none';
    setActiveNav('favourites');

    var favs = getFavourites();

    if (favs.length === 0) {
      render(h('div', { className: 'fav-empty' }, [
        h('div', null, 'No favourites yet.'),
        h('div', { style: 'margin-top: 0.5rem;' },
          'Tap the star on any comic to save it here.')
      ]));
      return;
    }

    var container = h('div', null, []);
    container.appendChild(h('div', { className: 'text-center mb-half' },
      favs.length + ' favourite' + (favs.length === 1 ? '' : 's')));

    // Show in reverse order (most recently added first)
    var reversed = favs.slice().reverse();
    reversed.forEach(function (fav) {
      var src = SOURCES[fav.source];
      var item = h('div', { className: 'fav-item' }, [
        h('span', { className: 'fav-item-source' }, src ? src.name : fav.source),
        h('span', { className: 'fav-item-title' }, fav.title || '#' + fav.id)
      ]);
      addTapFeedback(item);

      // Navigate to the comic. For numbered comics, we need to find the index.
      (function (f) {
        function goToFav(e) {
          e.preventDefault();
          var s = SOURCES[f.source];
          if (!s) return;

          // Load data to find the index
          var dataFile = s.archiveFile || s.dataFile;
          loadJSON(dataFile, function (err, data) {
            if (err) {
              navigate('comic/' + f.source + '/latest');
              return;
            }
            var comics = data.comics || [];
            var idx = -1;
            for (var i = 0; i < comics.length; i++) {
              var cId = comics[i].num !== undefined ? String(comics[i].num) : (comics[i].slug || String(i));
              if (cId === f.id) {
                idx = i;
                break;
              }
            }
            if (idx >= 0) {
              var isArchive = s.archiveFile && data.total;
              navigate('comic/' + f.source + '/' + idx + (isArchive ? '/archive' : ''));
            } else {
              navigate('comic/' + f.source + '/latest');
            }
          });
        }
        item.addEventListener('touchend', goToFav);
        item.addEventListener('click', goToFav);
      })(fav);

      container.appendChild(item);
    });

    render(container);
  }

  // =========================================================================
  // Router
  // =========================================================================

  function navigate(route) {
    window.location.hash = '#' + route;
  }

  function handleRoute() {
    var hash = window.location.hash.replace(/^#\/?/, '');
    var parts = hash.split('/');

    currentRoute = hash;

    // Reset header state
    headerFav.style.display = 'inline';

    if (!hash || hash === 'home') {
      renderHome();
    } else if (parts[0] === 'comic' && parts.length >= 3) {
      var sourceId = parts[1];
      var comicIdx = parts[2];
      var fromArchive = parts[3] === 'archive';
      renderComicReader(sourceId, comicIdx, fromArchive);
    } else if (parts[0] === 'archive' && parts.length >= 2) {
      var archiveSource = parts[1];
      var page = parts[2] || '0';
      renderArchive(archiveSource, page);
    } else if (parts[0] === 'random') {
      renderRandom();
    } else if (parts[0] === 'discover') {
      renderDiscover();
    } else if (parts[0] === 'favourites') {
      renderFavourites();
    } else {
      renderHome();
    }
  }

  // =========================================================================
  // Navigation bar
  // =========================================================================

  function setActiveNav(route) {
    var btns = document.querySelectorAll('.nav-btn');
    for (var i = 0; i < btns.length; i++) {
      var btn = btns[i];
      var btnRoute = btn.getAttribute('data-route');
      if (btnRoute === route) {
        btn.className = 'nav-btn active';
      } else {
        btn.className = 'nav-btn';
      }
    }
  }

  // =========================================================================
  // Event bindings
  // =========================================================================

  function init() {
    // Hash change routing
    window.addEventListener('hashchange', handleRoute);

    // Navigation buttons
    var navBtns = document.querySelectorAll('.nav-btn');
    for (var i = 0; i < navBtns.length; i++) {
      (function (btn) {
        addTapFeedback(btn);
        function go(e) {
          e.preventDefault();
          navigate(btn.getAttribute('data-route'));
        }
        btn.addEventListener('touchend', go);
        btn.addEventListener('click', go);
      })(navBtns[i]);
    }

    // Header back button
    headerBack.addEventListener('touchend', function (e) {
      e.preventDefault();
      window.history.back();
    });
    headerBack.addEventListener('click', function (e) {
      e.preventDefault();
      window.history.back();
    });

    // Header favourites button
    headerFav.addEventListener('touchend', function (e) {
      e.preventDefault();
      navigate('favourites');
    });
    headerFav.addEventListener('click', function (e) {
      e.preventDefault();
      navigate('favourites');
    });

    // Initial route
    handleRoute();
  }

  // Start the app
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
