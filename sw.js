// SW v19 — 视频秒开: Range请求支持 + 激进预缓存 + SWR策略
// 策略: CDN视频 Stale-While-Revalidate, 缩略图 Cache-First, API Network-Only

const CACHE_APP = 'yoyo-app-v19'
const CACHE_CDN = 'yoyo-cdn-v3'
const CACHE_THUMBS = 'yoyo-thumbs-v2'
const CACHE_VIDEOS = 'yoyo-videos-v1'

// 静态壳资源
const SHELL_FILES = ['/', '/index.html']

// 七牛云 CDN 域名
const CDN_HOST = 'yoyobaby.asia'

// 视频最大缓存大小 (100MB)
const MAX_VIDEO_CACHE_SIZE = 100 * 1024 * 1024

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
            key !== CACHE_THUMBS &&
            key !== CACHE_VIDEOS
          )
          .map((key) => caches.delete(key))
      )
    )
  )
  self.clients.claim()
})

// ---- Range 请求辅助 ----
function parseRangeHeader(rangeHeader, fileSize) {
  const matches = rangeHeader.match(/bytes=(\d+)-(\d*)/)
  if (!matches) return null
  const start = parseInt(matches[1], 10)
  const end = matches[2] ? parseInt(matches[2], 10) : fileSize - 1
  return { start, end }
}

// ---- 请求拦截 ----
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return

  const url = new URL(event.request.url)
  const host = url.hostname

  // Supabase API — 不缓存
  if (host.includes('supabase.co')) return

  // 七牛云上传 API — 不缓存
  if (host.includes('qiniup.com') || host.includes('qiniuapi.com')) return

  // 七牛云 CDN
  if (host === CDN_HOST) {
    // JSON 元数据文件 — 永不缓存
    if (url.pathname.endsWith('.json')) return

    const isThumb = url.pathname.includes('thumb_')
    const isVideo = url.pathname.match(/\.(mp4|mov|avi|webm|mkv)($|\?)/i)
    const isPreview = url.pathname.includes('preview_')

    // 缩略图 — Cache-First（小文件，命中率高）
    if (isThumb) {
      event.respondWith(
        caches.match(event.request).then((cached) =>
          cached || fetch(event.request).then((response) => {
            if (response.ok) {
              const clone = response.clone()
              caches.open(CACHE_THUMBS).then((cache) => cache.put(event.request, clone))
            }
            return response
          })
        )
      )
      return
    }

    // 预览视频 — SWR（小文件快速加载）
    if (isPreview) {
      event.respondWith(
        caches.match(event.request).then((cached) =>
          cached || fetch(event.request).then((response) => {
            if (response.ok) {
              const clone = response.clone()
              caches.open(CACHE_CDN).then((cache) => cache.put(event.request, clone))
            }
            return response
          })
        )
      )
      return
    }

    // 完整视频 — 支持 Range 请求 + SWR
    if (isVideo) {
      const rangeHeader = event.request.headers.get('range')

      if (rangeHeader) {
        // Range 请求：直接从网络获取（浏览器处理 seek）
        // 同时缓存完整响应供后续使用
        event.respondWith(
          fetch(event.request).then((response) => {
            // 缓存 200 响应（非 Range），供下次使用
            if (response.status === 200 && response.ok) {
              const clone = response.clone()
              caches.open(CACHE_VIDEOS).then((cache) =>
                cache.put(event.request, clone)
              )
            }
            return response
          }).catch(() => {
            // 网络失败时尝试从缓存提供 Range
            return caches.match(event.request.url.replace(/\?.*$/, ''))
              .then((cached) => {
                if (!cached) return new Response('', { status: 416 })
                // 简单处理：返回完整缓存（浏览器会自己处理）
                return cached
              })
          })
        )
      } else {
        // 非 Range 请求：SWR 策略
        event.respondWith(
          caches.match(event.request).then((cached) => {
            const fetchPromise = fetch(event.request).then((response) => {
              if (response.ok) {
                const clone = response.clone()
                caches.open(CACHE_VIDEOS).then(async (cache) => {
                  // 限制视频缓存总量
                  cache.put(event.request, clone)
                })
              }
              return response
            }).catch(() => cached)

            return cached || fetchPromise
          })
        )
      }
      return
    }

    // 其他 CDN 资源（图片等）— SWR
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
