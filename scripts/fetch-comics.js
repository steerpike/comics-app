/**
 * fetch-comics.js
 *
 * Fetches comic data from upstream sources and writes JSON files to data/.
 * Designed to be run by a GitHub Action on a schedule (twice daily).
 *
 * Principles:
 * - Respectful crawling: rate-limited, small batches, proper User-Agent
 * - Minimal requests: only fetch what's new since last run
 * - Lightweight output: archive indices contain metadata only (not images)
 * - Images are loaded directly from comic servers by the browser at view time
 *
 * Environment variables:
 *   FULL_ARCHIVE=true  - Build full archive index (first run only, slow)
 */

var https = require('https');
var http = require('http');
var fs = require('fs');
var path = require('path');

var DATA_DIR = path.join(__dirname, '..', 'data');
var USER_AGENT = 'comics-app/1.0 (https://steerpike.github.io/comics-app; kindle comic browser for personal use)';
var RATE_LIMIT_MS = 500; // 500ms between requests to same host
var BATCH_SIZE = 20;     // Comics per "latest" feed
var FULL_ARCHIVE = process.env.FULL_ARCHIVE === 'true';

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function httpGet(url, callback) {
  var mod = url.indexOf('https') === 0 ? https : http;
  var options = {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'application/json, application/xml, text/xml, */*'
    },
    timeout: 15000 // 15 second connection timeout
  };

  var req = mod.get(url, options, function (res) {
    // Follow redirects
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      return httpGet(res.headers.location, callback);
    }

    if (res.statusCode !== 200) {
      return callback(new Error('HTTP ' + res.statusCode + ' for ' + url));
    }

    var chunks = [];
    res.on('data', function (chunk) { chunks.push(chunk); });
    res.on('end', function () {
      callback(null, Buffer.concat(chunks).toString('utf8'));
    });
    res.on('error', callback);
  });

  req.on('timeout', function () {
    req.destroy();
    callback(new Error('Request timed out after 15s for ' + url));
  });

  req.on('error', callback);
}

function fetchJSON(url, callback) {
  httpGet(url, function (err, body) {
    if (err) return callback(err);
    try {
      callback(null, JSON.parse(body));
    } catch (e) {
      callback(new Error('JSON parse error for ' + url + ': ' + e.message));
    }
  });
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function writeJSON(filename, data) {
  var filepath = path.join(DATA_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf8');
  console.log('  Wrote ' + filepath + ' (' + Math.round(fs.statSync(filepath).size / 1024) + 'KB)');
}

function readJSON(filename) {
  var filepath = path.join(DATA_DIR, filename);
  if (fs.existsSync(filepath)) {
    return JSON.parse(fs.readFileSync(filepath, 'utf8'));
  }
  return null;
}

// ---------------------------------------------------------------------------
// Simple XML helpers (no dependencies)
// ---------------------------------------------------------------------------

function extractBetween(str, startTag, endTag) {
  var results = [];
  var pos = 0;
  while (true) {
    var start = str.indexOf(startTag, pos);
    if (start === -1) break;
    start += startTag.length;
    var end = str.indexOf(endTag, start);
    if (end === -1) break;
    results.push(str.substring(start, end));
    pos = end + endTag.length;
  }
  return results;
}

function extractFirst(str, startTag, endTag) {
  var results = extractBetween(str, startTag, endTag);
  return results.length > 0 ? results[0] : '';
}

function stripCDATA(str) {
  return str.replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '').trim();
}

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(parseInt(n, 10)); });
}

// ---------------------------------------------------------------------------
// xkcd
// ---------------------------------------------------------------------------

async function fetchXkcd() {
  console.log('Fetching xkcd...');

  // Get latest comic number
  var latest = await new Promise(function (resolve, reject) {
    fetchJSON('https://xkcd.com/info.0.json', function (err, data) {
      if (err) return reject(err);
      resolve(data);
    });
  });

  var latestNum = latest.num;
  console.log('  Latest xkcd: #' + latestNum);

  // Fetch latest BATCH_SIZE comics
  var latestComics = [];
  for (var i = latestNum; i > Math.max(0, latestNum - BATCH_SIZE); i--) {
    // xkcd #404 doesn't exist (it's a 404 joke)
    if (i === 404) continue;

    await sleep(RATE_LIMIT_MS);

    var comic = await new Promise(function (resolve, reject) {
      var num = i; // capture in closure
      fetchJSON('https://xkcd.com/' + num + '/info.0.json', function (err, data) {
        if (err) {
          console.log('  Warning: failed to fetch xkcd #' + num + ': ' + err.message);
          return resolve(null);
        }
        resolve(data);
      });
    });

    if (comic) {
      latestComics.push({
        num: comic.num,
        title: comic.safe_title || comic.title,
        img: comic.img,
        alt: comic.alt || '',
        date: comic.year + '-' + padTwo(comic.month) + '-' + padTwo(comic.day)
      });
    }
  }

  writeJSON('xkcd-latest.json', {
    source: 'xkcd',
    url: 'https://xkcd.com',
    attribution: 'xkcd by Randall Munroe, CC BY-NC 2.5',
    latestNum: latestNum,
    fetchedAt: new Date().toISOString(),
    comics: latestComics
  });

  // Build/update archive index
  if (FULL_ARCHIVE) {
    await buildXkcdArchive(latestNum);
  } else {
    // Incremental: update existing archive with any new comics
    await updateXkcdArchive(latestNum, latestComics);
  }
}

async function buildXkcdArchive(latestNum) {
  console.log('  Building full xkcd archive index (this will take a while)...');

  var archive = [];
  var batchStart = 1;

  while (batchStart <= latestNum) {
    var batchEnd = Math.min(batchStart + 49, latestNum); // 50 at a time
    console.log('  Fetching xkcd #' + batchStart + ' to #' + batchEnd + '...');

    for (var i = batchStart; i <= batchEnd; i++) {
      if (i === 404) continue;

      await sleep(RATE_LIMIT_MS);

      var comic = await new Promise(function (resolve, reject) {
        var num = i;
        fetchJSON('https://xkcd.com/' + num + '/info.0.json', function (err, data) {
          if (err) {
            console.log('  Warning: skipping xkcd #' + num);
            return resolve(null);
          }
          resolve(data);
        });
      });

      if (comic) {
        archive.push({
          num: comic.num,
          title: comic.safe_title || comic.title,
          img: comic.img,
          alt: comic.alt || '',
          date: comic.year + '-' + padTwo(comic.month) + '-' + padTwo(comic.day)
        });
      }
    }

    batchStart = batchEnd + 1;

    // Write progress periodically (every 200 comics)
    if (archive.length % 200 < 50) {
      writeJSON('xkcd-archive.json', {
        source: 'xkcd',
        total: archive.length,
        latestNum: latestNum,
        fetchedAt: new Date().toISOString(),
        comics: archive
      });
    }
  }

  writeJSON('xkcd-archive.json', {
    source: 'xkcd',
    total: archive.length,
    latestNum: latestNum,
    fetchedAt: new Date().toISOString(),
    comics: archive
  });

  console.log('  Full xkcd archive: ' + archive.length + ' comics indexed');
}

async function updateXkcdArchive(latestNum, latestComics) {
  var existing = readJSON('xkcd-archive.json');
  if (!existing) {
    console.log('  No existing archive. Run with FULL_ARCHIVE=true to build it.');
    return;
  }

  var existingNums = {};
  existing.comics.forEach(function (c) { existingNums[c.num] = true; });

  var added = 0;
  latestComics.forEach(function (c) {
    if (!existingNums[c.num]) {
      existing.comics.push(c);
      added++;
    }
  });

  if (added > 0) {
    existing.comics.sort(function (a, b) { return a.num - b.num; });
    existing.total = existing.comics.length;
    existing.latestNum = latestNum;
    existing.fetchedAt = new Date().toISOString();
    writeJSON('xkcd-archive.json', existing);
    console.log('  Added ' + added + ' new comics to xkcd archive');
  } else {
    console.log('  xkcd archive already up to date');
  }
}

// ---------------------------------------------------------------------------
// Dinosaur Comics
// ---------------------------------------------------------------------------

async function fetchDinosaurComics() {
  console.log('Fetching Dinosaur Comics...');

  var rss = await new Promise(function (resolve, reject) {
    httpGet('https://www.qwantz.com/rssfeed.php', function (err, body) {
      if (err) return reject(err);
      resolve(body);
    });
  });

  var items = extractBetween(rss, '<item>', '</item>');
  var comics = [];

  items.forEach(function (item) {
    var title = stripCDATA(extractFirst(item, '<title>', '</title>'));
    var link = extractFirst(item, '<link>', '</link>').trim();
    var descriptionRaw = extractFirst(item, '<description>', '</description>').trim();
    var pubDate = extractFirst(item, '<pubDate>', '</pubDate>').trim();

    // Dinosaur Comics encodes description as HTML entities, decode first
    var description = decodeEntities(descriptionRaw);

    // Extract comic number from link: ?comic=NNNN
    var numMatch = link.match(/comic=(\d+)/);
    var num = numMatch ? parseInt(numMatch[1], 10) : 0;

    // Extract image URL from decoded HTML - look for comic image src
    var imgMatch = description.match(/src="([^"]*comic[^"]*\.png)"/i);
    var img = imgMatch ? imgMatch[1] : '';

    // Extract title/alt text from img tag's title attribute
    var titleMatch = description.match(/title="([^"]*)"/);
    var alt = titleMatch ? decodeEntities(titleMatch[1]) : '';

    if (num && img) {
      comics.push({
        num: num,
        title: decodeEntities(title),
        img: img,
        alt: alt,
        date: pubDate ? new Date(pubDate).toISOString().split('T')[0] : '',
        link: link
      });
    }
  });

  // Sort newest first
  comics.sort(function (a, b) { return b.num - a.num; });

  writeJSON('dinosaur-latest.json', {
    source: 'dinosaur',
    name: 'Dinosaur Comics',
    url: 'https://www.qwantz.com',
    attribution: 'Dinosaur Comics by Ryan North',
    fetchedAt: new Date().toISOString(),
    comics: comics.slice(0, BATCH_SIZE)
  });

  // Update archive with any new entries
  updateDinosaurArchive(comics);

  console.log('  Fetched ' + comics.length + ' Dinosaur Comics from RSS');
}

function updateDinosaurArchive(newComics) {
  var existing = readJSON('dinosaur-archive.json');
  if (!existing) {
    // Seed archive from RSS
    var highestNum = newComics.length > 0 ? newComics[0].num : 0;
    writeJSON('dinosaur-archive.json', {
      source: 'dinosaur',
      total: newComics.length,
      highestNum: highestNum,
      fetchedAt: new Date().toISOString(),
      comics: newComics.sort(function (a, b) { return a.num - b.num; })
    });
    return;
  }

  var existingNums = {};
  existing.comics.forEach(function (c) { existingNums[c.num] = true; });

  var added = 0;
  newComics.forEach(function (c) {
    if (!existingNums[c.num]) {
      existing.comics.push(c);
      added++;
    }
  });

  if (added > 0) {
    existing.comics.sort(function (a, b) { return a.num - b.num; });
    existing.total = existing.comics.length;
    existing.highestNum = Math.max(existing.highestNum, newComics[0].num);
    existing.fetchedAt = new Date().toISOString();
    writeJSON('dinosaur-archive.json', existing);
    console.log('  Added ' + added + ' new Dinosaur Comics to archive');
  }
}

// ---------------------------------------------------------------------------
// SMBC
// ---------------------------------------------------------------------------

async function fetchSMBC() {
  console.log('Fetching SMBC...');

  var rss = await new Promise(function (resolve, reject) {
    httpGet('https://www.smbc-comics.com/rss.php', function (err, body) {
      if (err) return reject(err);
      resolve(body);
    });
  });

  var items = extractBetween(rss, '<item>', '</item>');
  var comics = [];

  items.forEach(function (item, index) {
    var title = stripCDATA(extractFirst(item, '<title>', '</title>'));
    // Clean up title: remove "Saturday Morning Breakfast Cereal - " prefix
    title = title.replace(/^Saturday Morning Breakfast Cereal\s*-\s*/i, '');

    var link = extractFirst(item, '<link>', '</link>').trim();
    var description = stripCDATA(extractFirst(item, '<description>', '</description>'));
    var pubDate = extractFirst(item, '<pubDate>', '</pubDate>').trim();

    // Extract image URL from description HTML
    var imgMatch = description.match(/src="([^"]*)"/i);
    var img = imgMatch ? imgMatch[1] : '';

    // Extract hover text
    var hoverMatch = description.match(/Hovertext:<br\s*\/?>\s*(.*?)(?:<\/p>|$)/i);
    var alt = hoverMatch ? decodeEntities(hoverMatch[1].trim()) : '';

    // Extract slug from link for ID purposes
    var slugMatch = link.match(/\/comic\/(.+)$/);
    var slug = slugMatch ? slugMatch[1] : '';

    if (img) {
      comics.push({
        slug: slug,
        title: decodeEntities(title),
        img: img,
        alt: alt,
        date: pubDate ? new Date(pubDate).toISOString().split('T')[0] : '',
        link: link
      });
    }
  });

  writeJSON('smbc-latest.json', {
    source: 'smbc',
    name: 'SMBC',
    url: 'https://www.smbc-comics.com',
    attribution: 'Saturday Morning Breakfast Cereal by Zach Weinersmith',
    fetchedAt: new Date().toISOString(),
    comics: comics.slice(0, BATCH_SIZE)
  });

  console.log('  Fetched ' + comics.length + ' SMBC comics from RSS');
}

// ---------------------------------------------------------------------------
// Wondermark
// ---------------------------------------------------------------------------

async function fetchWondermark() {
  console.log('Fetching Wondermark...');

  var rss = await new Promise(function (resolve, reject) {
    httpGet('https://wondermark.com/feed/', function (err, body) {
      if (err) return reject(err);
      resolve(body);
    });
  });

  var items = extractBetween(rss, '<item>', '</item>');
  var comics = [];

  items.forEach(function (item) {
    var title = stripCDATA(extractFirst(item, '<title>', '</title>'));
    var link = extractFirst(item, '<link>', '</link>').trim();
    var content = extractFirst(item, '<content:encoded>', '</content:encoded>');
    content = stripCDATA(content);
    var pubDate = extractFirst(item, '<pubDate>', '</pubDate>').trim();

    // Extract image URL from content
    var imgMatch = content.match(/src="([^"]*(?:\.png|\.jpg|\.gif|\.jpeg)[^"]*)"/i);
    var img = imgMatch ? decodeEntities(imgMatch[1]) : '';

    // Extract alt text from img tag
    var altMatch = content.match(/alt="([^"]*)"/i);
    var alt = altMatch ? decodeEntities(altMatch[1]) : '';

    // Extract number from URL if present (e.g., wondermark.com/c/1234/)
    var numMatch = link.match(/\/c\/(\d+)/);
    var num = numMatch ? parseInt(numMatch[1], 10) : 0;

    // Only include entries that have comic images (skip blog posts)
    if (img && (img.indexOf('comic') !== -1 || img.indexOf('wp-content') !== -1)) {
      comics.push({
        num: num,
        title: decodeEntities(title),
        img: img,
        alt: alt,
        date: pubDate ? new Date(pubDate).toISOString().split('T')[0] : '',
        link: link
      });
    }
  });

  writeJSON('wondermark-latest.json', {
    source: 'wondermark',
    name: 'Wondermark',
    url: 'https://wondermark.com',
    attribution: 'Wondermark by David Malki!',
    fetchedAt: new Date().toISOString(),
    comics: comics.slice(0, BATCH_SIZE)
  });

  console.log('  Fetched ' + comics.length + ' Wondermark comics from RSS');
}

// ---------------------------------------------------------------------------
// Nedroid
// ---------------------------------------------------------------------------

async function fetchNedroid() {
  console.log('Fetching Nedroid...');

  var rss = await new Promise(function (resolve, reject) {
    httpGet('https://nedroid.com/feed/', function (err, body) {
      if (err) return reject(err);
      resolve(body);
    });
  });

  var items = extractBetween(rss, '<item>', '</item>');
  var comics = [];

  items.forEach(function (item) {
    var title = stripCDATA(extractFirst(item, '<title>', '</title>'));
    var link = extractFirst(item, '<link>', '</link>').trim();
    var pubDate = extractFirst(item, '<pubDate>', '</pubDate>').trim();

    // Nedroid uses <description> with CDATA, not <content:encoded>
    var description = stripCDATA(extractFirst(item, '<description>', '</description>'));

    // Extract image URL - Nedroid uses single quotes: src='...'
    var imgMatch = description.match(/src=['"](http[^'"]*(?:\.png|\.jpg|\.gif|\.jpeg)[^'"]*)['"]/i);
    var img = imgMatch ? decodeEntities(imgMatch[1]) : '';

    // Extract comic number from link: ?NNN
    var numMatch = link.match(/\?(\d+)/);
    var num = numMatch ? parseInt(numMatch[1], 10) : 0;

    if (img) {
      comics.push({
        num: num,
        title: decodeEntities(title),
        img: img,
        alt: '', // Nedroid RSS doesn't include alt text
        date: pubDate ? new Date(pubDate).toISOString().split('T')[0] : '',
        link: link
      });
    }
  });

  writeJSON('nedroid-latest.json', {
    source: 'nedroid',
    name: 'Nedroid',
    url: 'https://nedroid.com',
    attribution: 'Nedroid by Anthony Clark',
    fetchedAt: new Date().toISOString(),
    comics: comics.slice(0, BATCH_SIZE)
  });

  console.log('  Fetched ' + comics.length + ' Nedroid comics from RSS');
}

// ---------------------------------------------------------------------------
// Poorly Drawn Lines
// ---------------------------------------------------------------------------

async function fetchPoorlyDrawnLines() {
  console.log('Fetching Poorly Drawn Lines...');

  var rss = await new Promise(function (resolve, reject) {
    httpGet('https://poorlydrawnlines.com/feed/', function (err, body) {
      if (err) return reject(err);
      resolve(body);
    });
  });

  var items = extractBetween(rss, '<item>', '</item>');
  var comics = [];

  items.forEach(function (item) {
    var title = stripCDATA(extractFirst(item, '<title>', '</title>'));
    var link = extractFirst(item, '<link>', '</link>').trim();
    var pubDate = extractFirst(item, '<pubDate>', '</pubDate>').trim();

    // Only include items categorised as Comic
    var categories = extractBetween(item, '<category><![CDATA[', ']]></category>');
    var isComic = false;
    categories.forEach(function (cat) {
      if (cat.toLowerCase() === 'comic') isComic = true;
    });
    if (!isComic) return;

    // Image is in <content:encoded> as a WordPress figure/img
    var content = stripCDATA(extractFirst(item, '<content:encoded>', '</content:encoded>'));
    var imgMatch = content.match(/src="([^"]*\.png)[^"]*"/i) || content.match(/src="([^"]*\.jpg)[^"]*"/i);
    var img = imgMatch ? decodeEntities(imgMatch[1]) : '';

    // Extract slug from link for ID purposes
    var slugMatch = link.match(/\/comic\/([^/]+)\/?$/);
    var slug = slugMatch ? slugMatch[1] : '';

    if (img) {
      comics.push({
        slug: slug,
        title: decodeEntities(title),
        img: img,
        alt: '',
        date: pubDate ? new Date(pubDate).toISOString().split('T')[0] : '',
        link: link
      });
    }
  });

  writeJSON('poorlydrawnlines-latest.json', {
    source: 'poorlydrawnlines',
    name: 'Poorly Drawn Lines',
    url: 'https://poorlydrawnlines.com',
    attribution: 'Poorly Drawn Lines by Reza Farazmand',
    fetchedAt: new Date().toISOString(),
    comics: comics.slice(0, BATCH_SIZE)
  });

  console.log('  Fetched ' + comics.length + ' Poorly Drawn Lines comics from RSS');
}

// ---------------------------------------------------------------------------
// Savage Chickens
// ---------------------------------------------------------------------------

async function fetchSavageChickens() {
  console.log('Fetching Savage Chickens...');

  var rss = await new Promise(function (resolve, reject) {
    httpGet('https://www.savagechickens.com/feed', function (err, body) {
      if (err) return reject(err);
      resolve(body);
    });
  });

  var items = extractBetween(rss, '<item>', '</item>');
  var comics = [];

  items.forEach(function (item) {
    var title = stripCDATA(extractFirst(item, '<title>', '</title>'));
    var link = extractFirst(item, '<link>', '</link>').trim();
    var pubDate = extractFirst(item, '<pubDate>', '</pubDate>').trim();

    // Image is in <content:encoded> inside a <p><img> tag
    var content = stripCDATA(extractFirst(item, '<content:encoded>', '</content:encoded>'));
    var imgMatch = content.match(/src="([^"]*\.jpg)"/i) || content.match(/src="([^"]*\.png)"/i);
    var img = imgMatch ? decodeEntities(imgMatch[1]) : '';

    // Extract alt text from img tag
    var altMatch = content.match(/alt="([^"]*)"/i);
    var alt = altMatch ? decodeEntities(altMatch[1]) : '';

    // Extract slug from link for ID purposes
    var slugMatch = link.match(/\.com\/\d{4}\/\d{2}\/([^/.]+)/);
    var slug = slugMatch ? slugMatch[1] : '';

    if (img) {
      comics.push({
        slug: slug,
        title: decodeEntities(title),
        img: img,
        alt: alt,
        date: pubDate ? new Date(pubDate).toISOString().split('T')[0] : '',
        link: link
      });
    }
  });

  writeJSON('savagechickens-latest.json', {
    source: 'savagechickens',
    name: 'Savage Chickens',
    url: 'https://www.savagechickens.com',
    attribution: 'Savage Chickens by Doug Savage',
    fetchedAt: new Date().toISOString(),
    comics: comics.slice(0, BATCH_SIZE)
  });

  console.log('  Fetched ' + comics.length + ' Savage Chickens comics from RSS');
}

// ---------------------------------------------------------------------------
// Buttersafe
// ---------------------------------------------------------------------------

async function fetchButtersafe() {
  console.log('Fetching Buttersafe...');

  var rss = await new Promise(function (resolve, reject) {
    httpGet('https://www.buttersafe.com/feed/', function (err, body) {
      if (err) return reject(err);
      resolve(body);
    });
  });

  var items = extractBetween(rss, '<item>', '</item>');
  var comics = [];

  items.forEach(function (item) {
    var title = stripCDATA(extractFirst(item, '<title>', '</title>'));
    var link = extractFirst(item, '<link>', '</link>').trim();
    var pubDate = extractFirst(item, '<pubDate>', '</pubDate>').trim();

    // Image is in <description> as an <img> tag with RSS-specific image URL
    var description = stripCDATA(extractFirst(item, '<description>', '</description>'));
    var imgMatch = description.match(/src="([^"]*)"/i);
    var img = imgMatch ? decodeEntities(imgMatch[1]) : '';

    // Extract alt/title text from img tag
    var titleMatch = description.match(/title="([^"]*)"/i);
    var alt = titleMatch ? decodeEntities(titleMatch[1]) : '';

    // Extract slug from link for ID purposes
    var slugMatch = link.match(/\/(\d{4}\/\d{2}\/\d{2}\/[^/]+)/);
    var slug = slugMatch ? slugMatch[1].replace(/\//g, '-') : '';

    if (img) {
      comics.push({
        slug: slug,
        title: decodeEntities(title),
        img: img,
        alt: alt,
        date: pubDate ? new Date(pubDate).toISOString().split('T')[0] : '',
        link: link
      });
    }
  });

  writeJSON('buttersafe-latest.json', {
    source: 'buttersafe',
    name: 'Buttersafe',
    url: 'https://www.buttersafe.com',
    attribution: 'Buttersafe by Alex Culang and Raynato Castro',
    fetchedAt: new Date().toISOString(),
    comics: comics.slice(0, BATCH_SIZE)
  });

  console.log('  Fetched ' + comics.length + ' Buttersafe comics from RSS');
}

// ---------------------------------------------------------------------------
// Loading Artist
// ---------------------------------------------------------------------------

async function fetchLoadingArtist() {
  console.log('Fetching Loading Artist...');

  var rss = await new Promise(function (resolve, reject) {
    httpGet('https://loadingartist.com/index.xml', function (err, body) {
      if (err) return reject(err);
      resolve(body);
    });
  });

  var items = extractBetween(rss, '<item>', '</item>');
  var comics = [];

  items.forEach(function (item) {
    var title = extractFirst(item, '<title>', '</title>');
    var link = extractFirst(item, '<link>', '</link>').trim();
    var pubDate = extractFirst(item, '<pubDate>', '</pubDate>').trim();

    // Only include items categorised as comic (skip news posts)
    var category = extractFirst(item, '<category>', '</category>').trim();
    if (category !== 'comic') return;

    // Image is in <content:encoded> inside a <picture> element
    // Prefer the JPG fallback <img> src for Kindle compatibility
    var content = extractFirst(item, '<content:encoded>', '</content:encoded>');
    content = decodeEntities(content);

    // Get the main <img> src (JPG fallback, 550w size)
    var imgMatch = content.match(/<img\s[^>]*src="([^"]*\.jpg)"/i);
    var img = imgMatch ? imgMatch[1] : '';

    // Get alt text (Loading Artist has excellent descriptive alt text)
    var altMatch = content.match(/<img\s[^>]*alt="([^"]*)"/i);
    var alt = altMatch ? altMatch[1] : '';

    // Extract slug from link
    var slugMatch = link.match(/\/comic\/([^/]+)\/?$/);
    var slug = slugMatch ? slugMatch[1] : '';

    if (img) {
      comics.push({
        slug: slug,
        title: title,
        img: img,
        alt: alt,
        date: pubDate ? new Date(pubDate).toISOString().split('T')[0] : '',
        link: link
      });
    }
  });

  writeJSON('loadingartist-latest.json', {
    source: 'loadingartist',
    name: 'Loading Artist',
    url: 'https://loadingartist.com',
    attribution: 'Loading Artist by Gregor Czaykowski',
    fetchedAt: new Date().toISOString(),
    comics: comics.slice(0, BATCH_SIZE)
  });

  console.log('  Fetched ' + comics.length + ' Loading Artist comics from RSS');
}

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

function writeMeta(results) {
  writeJSON('meta.json', {
    fetchedAt: new Date().toISOString(),
    sources: results,
    nextFetch: 'Automatic via GitHub Actions (twice daily)'
  });
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function padTwo(n) {
  var s = String(n);
  return s.length < 2 ? '0' + s : s;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Comics App - Data Fetcher');
  console.log('========================');
  console.log('Full archive mode: ' + FULL_ARCHIVE);
  console.log('');

  // Ensure data directory exists
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  var results = {};

  // Fetch each source, continue on failure
  try {
    await fetchXkcd();
    results.xkcd = 'ok';
  } catch (err) {
    console.error('Error fetching xkcd: ' + err.message);
    results.xkcd = 'error: ' + err.message;
  }

  try {
    await fetchDinosaurComics();
    results.dinosaur = 'ok';
  } catch (err) {
    console.error('Error fetching Dinosaur Comics: ' + err.message);
    results.dinosaur = 'error: ' + err.message;
  }

  try {
    await fetchSMBC();
    results.smbc = 'ok';
  } catch (err) {
    console.error('Error fetching SMBC: ' + err.message);
    results.smbc = 'error: ' + err.message;
  }

  try {
    await fetchWondermark();
    results.wondermark = 'ok';
  } catch (err) {
    console.error('Error fetching Wondermark: ' + err.message);
    results.wondermark = 'error: ' + err.message;
  }

  try {
    await fetchNedroid();
    results.nedroid = 'ok';
  } catch (err) {
    console.error('Error fetching Nedroid: ' + err.message);
    results.nedroid = 'error: ' + err.message;
  }

  try {
    await fetchPoorlyDrawnLines();
    results.poorlydrawnlines = 'ok';
  } catch (err) {
    console.error('Error fetching Poorly Drawn Lines: ' + err.message);
    results.poorlydrawnlines = 'error: ' + err.message;
  }

  try {
    await fetchSavageChickens();
    results.savagechickens = 'ok';
  } catch (err) {
    console.error('Error fetching Savage Chickens: ' + err.message);
    results.savagechickens = 'error: ' + err.message;
  }

  try {
    await fetchButtersafe();
    results.buttersafe = 'ok';
  } catch (err) {
    console.error('Error fetching Buttersafe: ' + err.message);
    results.buttersafe = 'error: ' + err.message;
  }

  try {
    await fetchLoadingArtist();
    results.loadingartist = 'ok';
  } catch (err) {
    console.error('Error fetching Loading Artist: ' + err.message);
    results.loadingartist = 'error: ' + err.message;
  }

  writeMeta(results);

  console.log('');
  console.log('Done. Results:', JSON.stringify(results));
}

main().catch(function (err) {
  console.error('Fatal error:', err);
  process.exit(1);
});
