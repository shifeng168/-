// SW v14 — 悠悠时光性能优化版
// 策略: 应用壳 Cache-First, CDN资产 Stale-While-Revalidate, API Network-Only

const CACHE_APP = 'yoyo-app-v14'
const CACHE_CDN = 'yoyo-cdn-v1'
const CACHE_THUMBS = 'yoyo-thumbs-v1'

// 静态壳资源（离线可加载）
const SHELL_FILES = ['/', '/index.html']

// 七牛云 CDN 域名
const CDN_HOST = 'yoyobaby.asia'

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
          .filter((key) => key !== CACHE_APP && key !== CACHE_CDN && key !== CACHE_THUMBS)
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

  // Supabase API — 不缓存
  if (host.includes('supabase.co')) return

  // 七牛云上传 API — 不缓存
  if (host.includes('qiniup.com') || host.includes('qiniuapi.com')) return

  // 七牛云 CDN  — Stale-While-Revalidate（先缓存后更新）
  if (host === CDN_HOST) {
    // 缩略图用独立缓存，更长生命周期
    const cacheName = url.pathname.includes('thumb_') ? CACHE_THUMBS : CACHE_CDN

    event.respondWith(
      caches.match(event.request).then((cached) => {
        const fetchPromise = fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone()
            caches.open(cacheName).then((cache) => cache.put(event.request, clone))
          }
          return response
        }).catch(() => cached)

        // 有缓存先用缓存，无缓存等网络
        return cached || fetchPromise
      })
    )
    return
  }

  // 应用资源 — Cache-First（优先缓存，快速加载）
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

  // HTML 请求 — Network-First，回退缓存
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
