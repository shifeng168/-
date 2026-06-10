// SW v23 — OSS 迁移 + 简化策略
// CDN 资源(七牛云/OSS)直通不走 SW，由浏览器缓存+CDN处理
// App 资源(JS/CSS/HTML) Network-First 缓存

const CACHE_NAME = 'baby-album-v23'
const SHELL_URL = './悠悠时光.html'

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll([SHELL_URL]))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return
  const url = new URL(e.request.url)

  // CDN / API 直通: 七牛云存量 + OSS 新增 + Supabase + Server酱
  if (
    url.hostname.includes('yoyobaby.asia') ||
    url.hostname.includes('aliyuncs.com') ||
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('sctapi.ftqq.com') ||
    url.hostname.includes('qiniup.com')
  ) return

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const clone = res.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone))
        }
        return res
      })
      .catch(() => caches.match(e.request).then((cached) => cached || caches.match(SHELL_URL)))
  )
})
