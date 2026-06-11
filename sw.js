// SW v24 — 阿里云 OSS 国内加速：高清 poster + 原画秒播, SWR 缓存策略
// 所有资源走 youyoushiguang.oss-cn-guangzhou.aliyuncs.com

const CACHE_APP = 'yoyo-app-v24'
const CACHE_CDN = 'yoyo-cdn-v5'
const CACHE_POSTERS = 'yoyo-posters-v1'
const CACHE_VIDEOS = 'yoyo-videos-v2'

const SHELL_FILES = ['/', '/index.html']

// 阿里云 OSS 域名
const OSS_HOST = 'youyoushiguang.oss-cn-guangzhou.aliyuncs.com'

// ---- 安装 ----
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_APP).then((cache) => cache.addAll(SHELL_FILES))
  )
  self.skipWaiting()
})

// ---- 激活 ----
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) =>
            key !== CACHE_APP &&
            key !== CACHE_CDN &&
            key !== CACHE_POSTERS &&
            key !== CACHE_VIDEOS
          )
          .map((key) => caches.delete(key))
      )
    )
  )
  self.clients.claim()
})

// ---- 请求拦截 ----
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return

  const url = new URL(event.request.url)
  const host = url.hostname

  // 阿里云 OSS 上传 API — 不缓存
  if (host.includes('aliyuncs.com') && (
    url.pathname === '/' ||
    event.request.headers.get('content-type')?.includes('multipart')
  )) return

  // JSON 元数据 — 永不缓存
  if (url.pathname.endsWith('.json')) return

  // OSS 资源
  if (host === OSS_HOST) {
    const isPoster = url.pathname.includes('poster_')
    const isVideo = url.pathname.match(/\.(mp4|mov|avi|webm|mkv)($|\?)/i)

    // Poster 帧 — Cache-First（小文件，秒显）
    if (isPoster) {
      event.respondWith(
        caches.match(event.request).then((cached) =>
          cached || fetch(event.request).then((response) => {
            if (response.ok) {
              const clone = response.clone()
              caches.open(CACHE_POSTERS).then((cache) => cache.put(event.request, clone))
            }
            return response
          })
        )
      )
      return
    }

    // 完整视频 — SWR (Stale-While-Revalidate)
    if (isVideo) {
      event.respondWith(
        caches.match(event.request).then((cached) => {
          const fetchPromise = fetch(event.request).then((response) => {
            if (response.ok) {
              const clone = response.clone()
              caches.open(CACHE_VIDEOS).then((cache) => cache.put(event.request, clone))
            }
            return response
          }).catch(() => cached)
          return cached || fetchPromise
        })
      )
      return
    }

    // 其他 OSS 资源（图片等）— SWR
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const fetchPromise = fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone()
            caches.open(CACHE_CDN).then((cache) => cache.put(event.request, clone))
          }
          return response
        }).catch(() => cached)
        return cached || fetchPromise
      })
    )
    return
  }

  // 应用资源 — Cache-First
  if (event.request.destination === 'script' ||
      event.request.destination === 'style' ||
      event.request.destination === 'image' ||
      event.request.destination === 'font') {
    event.respondWith(
      caches.match(event.request).then((cached) =>
        cached || fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone()
            caches.open(CACHE_APP).then((cache) => cache.put(event.request, clone))
          }
          return response
        })
      )
    )
    return
  }

  // HTML 请求 — Network-First
  event.respondWith(
    fetch(event.request).then((response) => {
      if (response.ok) {
        const clone = response.clone()
        caches.open(CACHE_APP).then((cache) => cache.put(event.request, clone))
      }
      return response
    }).catch(() => caches.match(event.request))
  )
})
