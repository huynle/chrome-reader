export interface FileTreeEntry {
  name: string
  url: string
  type: 'directory' | 'file'
}

export function getParentDirectoryURL(fileURL: string): string | null {
  try {
    const url = new URL(fileURL)
    if (url.protocol !== 'file:') {
      return null
    }

    const pathname = url.pathname.endsWith('/')
      ? url.pathname.slice(0, -1)
      : url.pathname
    const lastSlash = pathname.lastIndexOf('/')
    if (lastSlash < 0) {
      return null
    }

    url.pathname = pathname.slice(0, lastSlash + 1)
    url.search = ''
    url.hash = ''
    return url.href
  } catch (_) {
    return null
  }
}

export function getFileName(fileURL: string): string {
  try {
    const url = new URL(fileURL)
    const path = decodeURIComponent(url.pathname.replace(/\/$/, ''))
    return path.slice(path.lastIndexOf('/') + 1)
  } catch (_) {
    return fileURL
  }
}

export function isMarkdownFile(url: string): boolean {
  return /\.(md|mdx|mkd|markdown)(?:[?#].*)?$/i.test(url)
}

export function parseDirectoryListing(
  html: string,
  directoryURL: string,
): FileTreeEntry[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const currentURL = new URL(directoryURL)
  const currentHref = currentURL.href
  const entries = parseAnchorDirectoryListing(doc, currentHref)

  if (entries.length) {
    return sortEntries(entries)
  }

  return sortEntries(parseChromeDirectoryListing(html, currentHref))
}

function parseAnchorDirectoryListing(
  doc: Document,
  currentHref: string,
): FileTreeEntry[] {
  return Array.from(doc.querySelectorAll('a[href]'))
    .map(anchor => {
      const href = anchor.getAttribute('href')
      if (!href || href === '../') {
        return null
      }

      let url: URL
      try {
        url = new URL(href, currentHref)
      } catch (_) {
        return null
      }

      if (url.protocol !== 'file:' || url.href === currentHref) {
        return null
      }

      const isDirectory = url.pathname.endsWith('/')
      if (!isDirectory && !isMarkdownFile(url.href)) {
        return null
      }

      const text = anchor.textContent?.trim().replace(/\/$/, '')
      const name = text || getFileName(url.href)
      if (!name || name === '..') {
        return null
      }

      return {
        name,
        url: url.href,
        type: isDirectory ? 'directory' : 'file',
      } as FileTreeEntry
    })
    .filter(Boolean)
}

function parseChromeDirectoryListing(
  html: string,
  currentHref: string,
): FileTreeEntry[] {
  const rows = html.matchAll(
    /addRow\("((?:\\.|[^"\\])*)",\s*"((?:\\.|[^"\\])*)",\s*(\d)/g,
  )

  return Array.from(rows)
    .map(([, rawName, rawHref, rawType]) => {
      const name = parseJSONString(rawName).replace(/\/$/, '')
      const href = parseJSONString(rawHref)

      if (!name || name === '..' || !href) {
        return null
      }

      let url: URL
      try {
        url = new URL(href, currentHref)
      } catch (_) {
        return null
      }

      const isDirectory = rawType === '1'
      if (
        url.protocol !== 'file:' ||
        (!isDirectory && !isMarkdownFile(url.href))
      ) {
        return null
      }

      if (isDirectory && !url.pathname.endsWith('/')) {
        url.pathname += '/'
      }

      return {
        name,
        url: url.href,
        type: isDirectory ? 'directory' : 'file',
      } as FileTreeEntry
    })
    .filter(Boolean) as FileTreeEntry[]
}

function parseJSONString(value: string): string {
  try {
    return JSON.parse(`"${value}"`)
  } catch (_) {
    return value
  }
}

function sortEntries(entries: FileTreeEntry[]): FileTreeEntry[] {
  return entries.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'directory' ? -1 : 1
    }
    return a.name.localeCompare(b.name)
  })
}
