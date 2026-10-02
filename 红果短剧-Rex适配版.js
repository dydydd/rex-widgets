// 红果短剧 widget — Rex (RexScript) 适配版
// 原 Forward/Aptv 版: 红果短剧-ATV-v3.2.0-多季聚合封面修复.js
// 适配改动:
//   1. 卡片 type 由 "url" 改为 Rex 识别的 "tmdb"(否则 Rex 不渲染详情/分集)
//   2. 卡片补全 Rex 读取的字段 mediaType / releaseDate / rating
//   3. 详情分集 episodeItems 同样用 type:"tmdb"
//   4. 单集播放对象 type 改 "tmdb"，保留 videoUrl + playerType(二进制确认 Rex 认)
//   5. Widget.http.get 去掉 Rex 不支持的 allow_redirects 选项(手动跟随 30x 兜底)
//   6. Widget.storage 存对象包 try，兼容 Rex 简单 KV
// 仍未知风险: Rex 详情链路是否允许"非 TMDB 的自定义 id"。若 Rex 强制按 TMDB id 查详情，
//   则自定义 series_id 走不通，只能降级为外链卡片(点到浏览器)。需真机验证。

WidgetMetadata = {
  id: "forward.redfruit.atv.v320.rex",
  title: "红果短剧 (Rex)",
  version: "3.2.0-rex1",
  requiredVersion: "0.0.1",
  description: "浏览、搜索红果短剧，自动聚合同系列多季内容 (Rex 适配)",
  author: "dydydd",
  site: "https://github.com/InchStudio/ForwardWidgets",
  iconurl: "https://hongguoduanju.com/favicon.ico",
  detailCacheDuration: 300,
  modules: [
    { id: "loadResource", title: "加载播放资源", functionName: "loadResource", type: "stream", cacheDuration: 0, params: [] },
    { id: "loadHot", title: "热门推荐", functionName: "loadHot", cacheDuration: 1800, params: [] },
    { id: "loadRealDrama", title: "真人剧", functionName: "loadRealDrama", cacheDuration: 1800, params: [] },
    { id: "loadComicDrama", title: "漫剧", functionName: "loadComicDrama", cacheDuration: 1800, params: [] },
    { id: "loadAiDrama", title: "AI剧", functionName: "loadAiDrama", cacheDuration: 1800, params: [] },
  ],
  search: { title: "搜索红果短剧", functionName: "search", params: [{ name: "keyword", title: "关键词", type: "input" }, { name: "page", title: "页码", type: "page" }] },
};

var HG_SITE = "https://hongguoduanju.com";
var HG_API = "https://api.fqnovel.com/novel_ug/share/landing_page";
var HG_HEADERS = { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 Version/16.6 Mobile/15E148 Safari/604.1", Accept: "text/html,application/xhtml+xml,application/json" };
var HG_GROUP_CACHE = "hg320.group.";

function clean(value) { return String(value || "").replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim(); }
function decodeUrl(value) { return String(value || "").replace(/\\u002F/g, "/").replace(/\\\//g, "/").replace(/&amp;/g, "&"); }
function escapedValue(html, key) { var m = html.match(new RegExp('"' + key + '"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"')); return m ? decodeUrl(m[1]) : ""; }
// 红果真实播放链: 先向 landing 接口要 chapter_ids，再用其中某个 id 取 play_url
async function getChapterIds(seriesId) {
  var r = await Widget.http.get(HG_API, { params: { series_id: String(seriesId), video_id: String(seriesId), chapter_id: String(seriesId), aid: "8662", performance_optimization: "1", share_type: "4" }, headers: HG_HEADERS });
  var body = r && r.data;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (x) { return []; } }
  var d = body && body.data;
  var ids = d && Array.isArray(d.chapter_ids) ? d.chapter_ids : [];
  return ids;
}
async function getPlayUrl(seriesId, chapterId) {
  var r = await Widget.http.get(HG_API, { params: { series_id: String(seriesId), video_id: String(seriesId), chapter_id: String(chapterId), aid: "8662", performance_optimization: "1", share_type: "4" }, headers: HG_HEADERS });
  var body = r && r.data;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (x) { return ""; } }
  var d = body && body.data;
  var s = d && d.series_data;
  var value = s && (s.play_url || s.video_url);
  if (!value) throw new Error("红果没有返回该集播放地址");
  return decodeUrl(value);
}
function getTitle(html) { var v = escapedValue(html, "series_title") || escapedValue(html, "title"); if (v) return clean(v); var m = html.match(/<title[^>]*>([^<]+)<\/title>/i); return m ? clean(m[1]).replace(/[_-].*$/, "") : "红果短剧"; }
function getCover(html) { return escapedValue(html, "series_cover") || escapedValue(html, "cover_url") || escapedValue(html, "poster_url"); }
function normalizeSeriesTitle(title) { return clean(title).replace(/第(?:\d+|[一二三四五六七八九十百千万]+)(?:季|部|篇)/g, "").replace(/(?:第)?\d+(?:季|部)$/g, "").replace(/[（(]\s*(?:第)?\d+(?:季|部)\s*[）)]/g, "").trim(); }
// Rex 适配: 卡片默认走 type:"tmdb"，否则 Rex 不渲染详情/分集
function makeCard(id, title, cover, description, link) { var item = { id: id, type: "tmdb", mediaType: "tv", title: title, description: description || "进入详情选择全集", releaseDate: "", rating: 0, coverUrl: cover || "", posterPath: cover || "", backdropPath: cover || "", link: link }; return item; }

// Rex 适配: Widget.http.get 不支持 allow_redirects，手动跟随一次 30x
async function getHtml(url) {
  var r = await Widget.http.get(url, { headers: HG_HEADERS });
  if (!r || typeof r.data !== "string") {
    // 尝试跟随 Location
    var loc = r && r.headers && (r.headers.location || r.headers.Location);
    if (loc) { r = await Widget.http.get(loc, { headers: HG_HEADERS }); }
  }
  if (!r || typeof r.data !== "string") throw new Error("红果页面返回为空");
  return r.data;
}

function parseCards(html) { var out = [], seen = {}, re = /<a[^>]+href=["'](?:https?:\/\/hongguoduanju\.com)?\/detail\?series_id=(\d+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi, m; while ((m = re.exec(html))) { var id = m[1]; if (seen[id]) continue; seen[id] = true; var block = m[2], text = clean(block), cm = text.match(/全(\d+)集/), title = text.split(/演员：|简介：/)[0].replace(/^全\d+集\s*/, "").trim(); if (!title || /^(播放正片|详情)$/.test(title)) title = "红果短剧 " + id; var im = block.match(/(?:src|data-src|data-original)=["']([^"']+)/i); var cover = im ? decodeUrl(im[1]) : ""; out.push(makeCard("hg320-series:" + id, title, cover, cm ? "全" + cm[1] + "集" : "进入详情选择全集", "hg320-series:" + id)); } return out; }

function extractJsonArrayAfter(html, marker) { var p = html.indexOf(marker); if (p < 0) return []; var s = html.indexOf("[", p); if (s < 0) return []; var depth = 0, q = false, e = false; for (var i = s; i < html.length; i += 1) { var c = html[i]; if (q) { if (e) e = false; else if (c === "\\") e = true; else if (c === '"') q = false; } else if (c === '"') q = true; else if (c === "[") depth += 1; else if (c === "]" && --depth === 0) { try { return JSON.parse(html.slice(s, i + 1)); } catch (x) { return []; } } } return []; }

function parseSearchGroups(html) { var list = extractJsonArrayAfter(html, '"searchList"'); var groups = {}; list.forEach(function (entry) { var d = entry && entry.video_data; if (!d || !d.series_id) return; var title = String(d.series_title || entry.name || "红果短剧"); var base = normalizeSeriesTitle(title); var key = base || title; if (!groups[key]) groups[key] = { title: base || title, entries: [], cover: decodeUrl(d.series_cover || ""), hot: d.hot_score_data && d.hot_score_data.text, tags: [] }; var g = groups[key]; var seasonTitle = title; var hot = d.hot_score_data && d.hot_score_data.text; if (!g.entries.some(function (x) { return x.seriesId === String(d.series_id); })) g.entries.push({ seriesId: String(d.series_id), title: seasonTitle, hot: hot }); if (!g.cover) g.cover = decodeUrl(d.series_cover || ""); (Array.isArray(d.category_list) ? d.category_list : []).forEach(function (x) { if (x.name && g.tags.indexOf(x.name) < 0) g.tags.push(x.name); }); }); return Object.keys(groups).map(function (key) { var g = groups[key]; var cacheKey = HG_GROUP_CACHE + encodeURIComponent(key); try { Widget.storage.set(cacheKey, g); } catch (x) {} return makeCard("hg320-group:" + encodeURIComponent(key), g.title, g.cover, [g.hot, g.entries.length + "季", g.tags.join(" · ")].filter(Boolean).join(" · "), "hg320-group:" + encodeURIComponent(key)); }); }

async function loadPath(path) { var x = parseCards(await getHtml(HG_SITE + path)); if (!x.length) throw new Error("没有找到红果短剧"); return x; }
async function loadHot(params) { return loadPath("/"); }
async function loadRealDrama(params) { return loadPath("/category/real-drama"); }
async function loadComicDrama(params) { return loadPath("/category/comic-drama"); }
async function loadAiDrama(params) { return loadPath("/category/ai-drama"); }
async function search(params) { var keyword = String((params && params.keyword) || "").trim(); if (!keyword) return loadHot(params); return parseSearchGroups(await getHtml(HG_SITE + "/search/" + encodeURIComponent(keyword))); }

async function loadDetail(link) {
  var raw = String(link || "");
  var gm = raw.match(/^hg320-group:(.+)$/);
  if (gm) {
    var key = decodeURIComponent(gm[1]);
    var group = null;
    try { group = Widget.storage.get(HG_GROUP_CACHE + encodeURIComponent(key)); } catch (x) {}
    if (!group) throw new Error("系列缓存已失效，请重新搜索");
    // 聚合所有季的集: 每集标题带"第N季 第M集"，link 用 player URL 交由 loadResource 解析
    // (不依赖 Rex 下钻: 无论 Rex 是否把 group 当单对象处理，集列表都直接可用)
    // 仅每季发 1 次 landing 请求拿 chapter_ids，标题/封面用搜索缓存，避免详情页额外请求导致转圈
    var all = [];
    for (var gi = 0; gi < group.entries.length; gi += 1) {
      var ge = group.entries[gi];
      var gCover = group.cover;
      var gTitle = ge.title || group.title;
      var gVids = await getChapterIds(ge.seriesId);
      for (var vi = 0; vi < gVids.length; vi += 1) {
        var gPlayer = HG_SITE + "/player/" + ge.seriesId + "/" + gVids[vi];
        all.push({ id: gPlayer, type: "tmdb", mediaType: "tv", title: "第" + (gi + 1) + "季 · " + gTitle + " 第" + (vi + 1) + "集", episode: vi + 1, seriesName: group.title, coverUrl: gCover, posterPath: gCover, backdropPath: gCover, link: gPlayer });
      }
    }
    return { id: raw, type: "tmdb", title: group.title, description: "共 " + group.entries.length + " 季 · " + all.length + " 集", coverUrl: group.cover, posterPath: group.cover, backdropPath: group.cover, link: raw, episodeItems: all };
  }
  var sm2 = raw.match(/^hg320-season:(\d+):(\d+)$/);
  if (sm2) {
    // 点某一季: 展开该季的集列表（仅 1 次 landing 请求，不逐集预拉 play_url）
    var sid = sm2[1], html = await getHtml(HG_SITE + "/detail?series_id=" + sid), title = getTitle(html), cover = getCover(html), vids = await getChapterIds(sid);
    if (!vids.length) throw new Error("没有找到该剧集目录");
    var items = [];
    for (var k = 0; k < vids.length; k += 1) items.push(makeEpisode(sid, title, cover, vids[k], k));
    return { id: raw, type: "tmdb", title: title, description: "共 " + vids.length + " 集", coverUrl: cover, posterPath: cover, backdropPath: cover, link: raw, episodeItems: items };
  }
  var sm = raw.match(/^hg320-series:(\d+)$/);
  if (sm) {
    var sid2 = sm[1], html2 = await getHtml(HG_SITE + "/detail?series_id=" + sid2), title2 = getTitle(html2), cover2 = getCover(html2), vids2 = await getChapterIds(sid2);
    if (!vids2.length) throw new Error("没有找到该剧集目录");
    var items2 = [];
    for (var k2 = 0; k2 < vids2.length; k2 += 1) items2.push(makeEpisode(sid2, title2, cover2, vids2[k2], k2));
    return { id: raw, type: "tmdb", title: title2, description: "共 " + vids2.length + " 集", coverUrl: cover2, posterPath: cover2, backdropPath: cover2, link: raw, episodeItems: items2 };
  }
  var cm = raw.match(/^hg320-chapter:(\d+):(\d+)$/);
  if (cm) {
    // 点某一集: 仅此 1 个请求拿播放地址，返回内联播放对象
    return { id: raw, type: "tmdb", mediaType: "tv", title: "红果短剧", description: "红果短剧播放资源", link: raw, videoUrl: await getPlayUrl(cm[1], cm[2]), playerType: "system" };
  }
  var pm = raw.match(/^https?:\/\/hongguoduanju\.com\/player\/(\d+)\/(\d+)\/?$/i);
  if (!pm) return null;
  return { id: raw, type: "tmdb", mediaType: "tv", title: "红果短剧", description: "红果短剧播放资源", link: raw, videoUrl: await getPlayUrl(pm[1], pm[2]), playerType: "system" };
}

// 单集对象: 不预拉 videoUrl (避免集列表上百条请求转圈)，link 用 player URL，由 Rex 点集时调 loadResource 解析
function makeEpisode(seriesId, title, cover, vid, index) {
  var player = HG_SITE + "/player/" + seriesId + "/" + vid;
  return { id: player, type: "tmdb", mediaType: "tv", title: title + " 第" + (index + 1) + "集", episode: index + 1, seriesName: title, coverUrl: cover, posterPath: cover, backdropPath: cover, link: player };
}

// Rex 适配: loadResource 返回 Rex 播放器认的 {url, playerType} 结构
// 兼容两种 link 格式: 原版 /player/series/vid 与内部 hg320-chapter:series:vid
async function loadResource(params) {
  params = params || {};
  var link = String(params.link || params.id || ""), m = link.match(/\/player\/(\d+)\/(\d+)\/?$/) || link.match(/^hg320-chapter:(\d+):(\d+)$/);
  if (!m) throw new Error("缺少红果分集链接");
  var play = await getPlayUrl(m[1], m[2]);
  return [{ name: "红果播放", description: String(params.seriesName || params.title || "红果短剧"), url: play, playerType: "system" }];
}
