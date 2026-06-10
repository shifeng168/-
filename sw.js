// SW v22 — 性能优化: Navigation Preload + SWR + 智能缓存分层
// 策略: CDN→SWR, 缩略图→Cache-First, API→Network-Only, App资源→Stale-While-Revalidate

const CACHE_APP = 'yoyo-app-v22'
const CACHE_STATIC = 'yoyo-static-v1'  // 长期缓存的大文件(图片/video)
const CACHE_THUMBS = 'yoyo-thumbs-v3'
const CACHE_VIDEOS = 'yoyo-videos-v2'

const CDN_HOST = 'yoyobaby.asia'

// ---- 激活: 启用 Navigation Preload 并清理旧缓存 ----
self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      // 启用 Navigation Preload (加速 HTML 请求)
      self.registration?.navigationPreload?.enable?.() || Promise.resolve(),
      // 清理所有旧版本缓存
      caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter((key) =>
              key !== CACHE_APP &&
              key !== CACHE_STATIC &&
              key !== CACHE_THUMBS &&
              key !== CACHE_VIDEOS
            )
            .map((key) => caches.delete(key))
        )
      ),
    ])
  )
  self.clients.claim()
})

// ---- SWR 通用缓存策略 ----
async function swrResponse(request, cacheName) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)

  const fetchPromise = fetch(request).then((response) => {
    if (response.ok) {
      cache.put(request, response.clone())
    }
    return response
  }).catch(() => cached)

  return cached || fetchPromise
}

// ---- Cache-First 策略(用于缩略图) ----
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)
  if (cached) return cached

  const response = await fetch(request)
  if (response.ok) {
    cache.put(request, response.clone())
  }
  return response
}

// ---- 请求拦截 ----
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return

  const url = new URL(event.request.url)
  const host = url.hostname

  // API 请求 — 永不缓存
  if (host.includes('supabase.co') || host.includes('qiniup.com') || host.includes('qiniuapi.com') || host.includes('sctapi.ftqq.com')) {
    return
  }

  // JSON 元数据文件 — Network-Only (不缓存)
  if (host === CDN_HOST && url.pathname.endsWith('.json')) return

  // 七牛云 CDN 资源
  if (host === CDN_HOST) {
    const path = url.pathname
    const isThumb = path.includes('thumb_')
    const isVideo = /\.(mp4|mov|avi|webm|mkv)($|\?)/i.test(path)
    const isPreview = path.includes('preview_')
    const isImage = /\.(jpg|jpeg|png|gif|webp|heic|bmp)($|\?)/i.test(path)

    // 缩略图 — Cache-First（文件小，命中率高，秒加载）
    if (isThumb) {
      event.respondWith(cacheFirst(event.request, CACHE_THUMBS))
      return
    }

    // 预览视频 — SWR（小文件快速加载）
    if (isPreview) {
      event.respondWith(swrResponse(event.request, CACHE_STATIC))
      return
    }

    // 视频 + Range 请求 — Network-First (支持拖动进度条)
    if (isVideo && event.request.headers.get('range')) {
      event.respondWith(
        fetch(event.request).then((response) => {
          if (response.status === 200 || response.status === 206) {
            const clone = response.clone()
            caches.open(CACHE_VIDEOS).then((cache) => cache.put(event.request, clone))
          }
          return response
        }).catch(() => caches.match(event.request))
      )
      return
    }

    // 完整视频(非Range) — SWR
    if (isVideo) {
      event.respondWith(swrResponse(event.request, CACHE_VIDEOS))
      return
    }

    // 图片等静态文件 — SWR
    if (isImage) {
      event.respondWith(swrResponse(event.request, CACHE_STATIC))
      return
    }

    // 其他 CDN 资源
    event.respondWith(swrResponse(event.request, CACHE_STATIC))
    return
  }

  // 应用资源 (JS/CSS/Font) — Cache-First
  const dest = event.request.destination
  if (dest === 'script' || dest === 'style' || dest === 'font') {
    event.respondWith(cacheFirst(event.request, CACHE_APP))
    return
  }

  // 图片（应用内资源）— SWR
  if (dest === 'image') {
    event.respondWith(swrResponse(event.request, CACHE_APP))
    return
  }

  // HTML — Network-First (配合 Navigation Preload)
  if (dest === 'document' || event.request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          // 优先使用 navigation preload 响应
          const preloadResponse = await event.preloadResponse
          if (preloadResponse) {
            // 更新缓存
            caches.open(CACHE_APP).then((cache) => cache.put(event.request, preloadResponse.clone()))
            return preloadResponse
          }
        } catch {}

        // Fallback: Network-First
        try {
          const response = await fetch(event.request)
          if (response.ok) {
            caches.open(CACHE_APP).then((cache) => cache.put(event.request, response.clone()))
          }
          return response
        } catch {
          const cached = await caches.match(event.request)
          return cached || Response.error()
        }
      })()
    )
    return
  }
})
