import throttle from 'lodash.throttle'
import Event from '@/core/event'
import storage from '@/core/storage'
import Ele, { svg } from '@/core/ele'
import { initPlugins } from '@/plugins'
import lifecycle from '@/core/lifecycle'
import className from '@/config/class-name'
import type { Theme } from '@/config/page-themes'
import { getDefaultData, type Data } from '@/core/data'
import { mdRender, type MdOptions } from '@/core/markdown'
import {
  getFileName,
  getParentDirectoryURL,
  parseDirectoryListing,
  type FileTreeEntry,
} from '@/core/file-tree'
import {
  getHeads,
  getRawContainer,
  setTheme,
  CONTENT_TYPES,
  darkMediaQuery,
  getMediaQueryTheme,
  toTheme,
} from '@/shared'
import codeIcon from '@/images/icon_code.svg'
import sideIcon from '@/images/icon_side.svg'
import goTopIcon from '@/images/icon_go_top.svg'
import '@/style/index.less'

function main(data: Data) {
  const configData = getDefaultData(data)

  // Initialize mermaid globally before any rendering
  if (configData.mdPlugins.includes('Mermaid')) {
    // Wait for mermaid to load with retries
    const initMermaid = (retries = 10) => {
      if (typeof (window as any).mermaid !== 'undefined') {
        const mermaid =
          (window as any).mermaid.default || (window as any).mermaid
        if (mermaid && typeof mermaid.initialize === 'function') {
          mermaid.initialize({
            startOnLoad: false,
            theme: configData.pageTheme === 'dark' ? 'dark' : 'default',
          })
        }
      } else if (retries > 0) {
        // Retry after 50ms if mermaid not loaded yet
        setTimeout(() => initMermaid(retries - 1), 50)
      } else {
        console.warn('Mermaid library failed to load')
      }
    }
    initMermaid()
  }

  const actions = {
    reload() {
      window.location.reload()
    },
    updateMdPlugins() {
      reloading = true
      if (mdRaw) {
        contentRender(mdRaw)
        renderSide()
      } else {
        window.location.reload()
      }
      reloading = false
    },
    updatePageTheme(theme: Theme, prevTheme: Theme) {
      setTheme(theme)
      renderContentByTheme(theme, prevTheme)
      updateOptionsMenuState()
    },
    updateFileTreeOptions() {
      fileTreeRootURL && renderFileTree(fileTreeRootURL)
      updateOptionsMenuState()
    },
    toggleRefresh(value) {
      clearTimeout(pollingTimer)
      value && polling()
    },
    toggleCentered(value) {
      mdContent.classList.toggle('centered', value)
    },
    toggleSide() {
      onToggleSide()
    },
  }
  chrome.runtime.onMessage.addListener(({ action, data: { key, value } }) => {
    const oldValue = configData[key]
    configData[key] = value
    actions[action]?.(value, oldValue)
  })

  if (!configData.enable || !CONTENT_TYPES.includes(document.contentType)) {
    return
  }

  let pollingTimer: number = null
  let reloading: boolean = false
  let mdRaw: string = null
  let isSideHover: boolean = false
  let globalEvent: Event = new Event()

  initPlugins({ event: globalEvent })

  /* init md page */
  setTheme(configData.pageTheme)
  document.body.classList.toggle(
    className.SIDE_COLLAPSED,
    configData.hiddenSide,
  )

  const rawContainer = getRawContainer()
  lifecycle.init(rawContainer)
  mdRaw = rawContainer?.textContent

  /* render content */
  const mdContent = new Ele<HTMLElement>('article', {
    className: `${className.MD_CONTENT} ${
      configData.centered ? 'centered' : ''
    }`,
  })

  const mdRenderer =
    (target: HTMLElement | Ele) =>
    (code: string = '', options?: MdOptions) => {
      target.innerHTML = mdRender(code, {
        theme: toTheme(configData.pageTheme),
        plugins: configData.mdPlugins,
        ...options,
      })
      // Initialize mermaid diagrams after rendering
      if (configData.mdPlugins.includes('Mermaid')) {
        const renderMermaid = (retries = 20) => {
          const targetEl =
            target instanceof HTMLElement ? target : (target as Ele).ele
          if (targetEl) {
            const mermaidElements = targetEl.querySelectorAll('.mermaid')
            if (mermaidElements.length > 0) {
              if (typeof (window as any).mermaid !== 'undefined') {
                // Check if mermaid is exported as default
                const mermaid =
                  (window as any).mermaid.default || (window as any).mermaid
                if (mermaid && typeof mermaid.run === 'function') {
                  mermaid
                    .run({
                      nodes: mermaidElements,
                    })
                    .catch((err: Error) => {
                      console.error('Mermaid rendering error:', err)
                    })
                } else if (mermaid && typeof mermaid.init === 'function') {
                  // Fallback to old API
                  mermaid.init(undefined, mermaidElements)
                } else if (retries > 0) {
                  // Retry if mermaid not ready
                  setTimeout(() => renderMermaid(retries - 1), 50)
                } else {
                  console.error('Mermaid: Neither run() nor init() available')
                }
              } else if (retries > 0) {
                // Retry if mermaid not loaded yet
                setTimeout(() => renderMermaid(retries - 1), 50)
              } else {
                console.warn('Mermaid library not loaded after 1 second')
              }
            }
          }
        }
        setTimeout(() => renderMermaid(), 100)
      }
    }
  const contentRender = mdRenderer(mdContent)
  contentRender(mdRaw)

  mdContent.on(
    'click',
    async e => {
      globalEvent.emit('click', e.target)
    },
    true,
  )

  const mdBody = new Ele<HTMLElement>(
    'main',
    { className: className.MD_BODY },
    mdContent,
  )

  /* render side */
  const mdSide = new Ele<HTMLElement>('ul', { className: className.MD_SIDE })
  const sideSwitch = new Ele<HTMLElement>('li', {
    className: 'md-reader__side-switch',
  })
  const fileTree = new Ele<HTMLElement>('li', {
    className: 'md-reader__side-file-tree',
  })
  const tocTree = new Ele<HTMLElement>('li', {
    className: 'md-reader__side-toc',
  })
  const tocList = new Ele<HTMLElement>('ul', {
    className: 'md-reader__toc-list',
  })
  const fileTreeRootURL = getParentDirectoryURL(window.location.href)
  let sideMode: 'files' | 'toc' = fileTreeRootURL ? 'files' : 'toc'
  let idCache: { [content: string]: number } = Object.create(null)
  let headElements: HTMLElement[] = []
  let sideLiElements: HTMLElement[] = []
  let df: Ele<DocumentFragment> = null
  let targetIndex: number = null
  mdSide.on('mouseenter', () => {
    isSideHover = true
  })
  mdSide.on('mouseleave', () => {
    isSideHover = false
  })

  renderSideSwitch()
  tocTree.append(tocList)
  if (fileTreeRootURL) {
    renderFileTree(fileTreeRootURL)
  }
  renderSide()
  document.addEventListener('scroll', throttle(onScroll, 100))

  /* render raw toggle button */
  const rawToggleBtn = new Ele<HTMLElement>(
    'button',
    {
      className: [className.MD_BUTTON, className.CODE_TOGGLE_BTN],
      title: 'Toggle raw',
    },
    svg(codeIcon),
  )
  rawToggleBtn.on('click', () => {
    lifecycle.toggleRaw([mdBody, mdSide])
  })

  /* render side expand button */
  const sideExpandBtn = new Ele<HTMLElement>(
    'button',
    {
      className: [className.MD_BUTTON, className.SIDE_EXPAND_BTN],
      title: 'Expand side',
    },
    svg(sideIcon),
  )
  sideExpandBtn.on('click', () => {
    chrome.runtime.sendMessage({
      action: 'storage',
      data: {
        key: 'hiddenSide',
        value: !configData.hiddenSide,
      },
    })
  })
  function onToggleSide() {
    if (window.innerWidth <= 960) {
      const value = document.body.classList.toggle(className.SIDE_EXPANDED)
      mdBody.off('click', foldSide, true)
      window.removeEventListener('resize', foldSide)
      document.removeEventListener('keydown', foldSide)
      if (value) {
        setTimeout(() => {
          mdBody.on('click', foldSide, { capture: true, once: true })
          window.addEventListener('resize', foldSide, { once: true })
          document.addEventListener('keydown', foldSide, { once: true })
        }, 0)
      }
    } else {
      configData.hiddenSide = document.body.classList.toggle(
        className.SIDE_COLLAPSED,
      )
    }
  }
  function foldSide(e: UIEvent) {
    if (e.type === 'keydown' && (e as KeyboardEvent).code !== 'Escape') {
      return
    }
    document.body.classList.remove(className.SIDE_EXPANDED)
    mdBody.off('click', foldSide, true)
    window.removeEventListener('resize', foldSide)
    document.removeEventListener('keydown', foldSide)
    e.stopPropagation()
    e.preventDefault()
    return false
  }
  /* render go top button */
  const goTopBtn = new Ele<HTMLElement>(
    'button',
    {
      className: [className.MD_BUTTON, className.GO_TOP_BTN],
      title: 'Go top',
    },
    svg(goTopIcon),
  )
  goTopBtn.hide()
  goTopBtn.on('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }))

  const optionsBtn = new Ele<HTMLElement>('button', {
    className: [className.MD_BUTTON, 'md-reader__btn--options'],
    title: 'Options',
  })
  optionsBtn.innerHTML = '<span></span><span></span><span></span>'

  const optionsMenu = new Ele<HTMLElement>('div', {
    className: 'md-reader__options-menu',
  })
  renderOptionsMenu()
  optionsBtn.on('click', e => {
    e.stopPropagation()
    optionsMenu.classList.toggle('opened')
  })
  optionsMenu.on('click', e => e.stopPropagation())
  document.addEventListener('click', () => {
    optionsMenu.classList.remove('opened')
  })

  const buttonWrap = new Ele<HTMLElement>(
    'div',
    { className: className.BUTTON_WRAP_ELE },
    [sideExpandBtn, rawToggleBtn, optionsBtn, optionsMenu, goTopBtn],
  )

  /* mount elements */
  lifecycle.mount([buttonWrap, mdBody, mdSide])
  updateAnchorPosition()

  darkMediaQuery.addEventListener('change', (e: MediaQueryListEvent) => {
    if (configData.pageTheme === 'auto') {
      renderContentByTheme(
        e.matches ? 'light' : 'dark',
        e.matches ? 'dark' : 'light',
      )
    }
  })

  /* auto refresh */
  if (configData.refresh) {
    polling()
  }

  function polling() {
    void (function watch() {
      clearTimeout(pollingTimer)
      chrome.runtime.sendMessage({ action: 'fetch' }, res => {
        if (res !== undefined) {
          if (mdRaw === undefined || mdRaw === null) {
            if (res) {
              window.location.reload()
              return
            }
          } else if (mdRaw !== res) {
            mdRaw = res
            contentRender(res)
            renderSide()
            /* update raw content */
            setTimeout(() => {
              rawContainer.textContent = res
            }, 0)
          }
        }
        pollingTimer = setTimeout(watch, 500)
      })
    })()
  }

  function renderSide() {
    idCache = Object.create(null)
    headElements = getHeads(mdContent)
    df = new Ele<DocumentFragment>('#document-fragment')
    sideLiElements = headElements.reduce(handleHeadItem, [])
    mdSide.innerHTML = null
    mdSide.append(sideSwitch)
    fileTreeRootURL && mdSide.append(fileTree)
    mdSide.append(tocTree)
    tocList.innerHTML = ''
    tocList.append(df)
    updateSideMode(sideMode)
    setTimeout(onScroll, 0)
  }

  function renderSideSwitch() {
    sideSwitch.innerHTML = ''
    const switcher = document.createElement('div')
    switcher.className = 'md-reader__side-switch-control'

    const filesButton = createSideSwitchButton('files', 'Files')
    const tocButton = createSideSwitchButton('toc', 'TOC')
    switcher.append(filesButton, tocButton)
    sideSwitch.append(switcher)
  }

  function createSideSwitchButton(mode: 'files' | 'toc', label: string) {
    const button = document.createElement('button')
    button.type = 'button'
    button.dataset.mode = mode
    button.textContent = label
    button.disabled = mode === 'files' && !fileTreeRootURL
    button.addEventListener('click', () => updateSideMode(mode))
    return button
  }

  function updateSideMode(mode: 'files' | 'toc') {
    sideMode = mode === 'files' && !fileTreeRootURL ? 'toc' : mode
    fileTree.classList.toggle('active', sideMode === 'files')
    tocTree.classList.toggle('active', sideMode === 'toc')
    sideSwitch
      .queryAll('button')
      .forEach(button =>
        button.classList.toggle('active', button.dataset.mode === sideMode),
      )
  }

  function renderFileTree(rootURL: string) {
    fileTree.innerHTML = ''
    const title = document.createElement('div')
    title.className = 'md-reader__file-tree-title'
    title.textContent = getFileName(rootURL) || 'Files'

    const list = document.createElement('ul')
    list.className = 'md-reader__file-tree-list'
    fileTree.append([title, list])
    loadFileTreeDirectory(rootURL, list)
  }

  function loadFileTreeDirectory(directoryURL: string, list: HTMLElement) {
    list.textContent = 'Loading...'
    chrome.runtime.sendMessage(
      { action: 'directory', data: { url: directoryURL } },
      (html: string) => {
        if (!html || chrome.runtime.lastError) {
          list.textContent = 'Unable to load files'
          return
        }

        const entries = parseDirectoryListing(html, directoryURL).filter(
          entry => !configData.hideDotFiles || !isDotEntry(entry),
        )
        list.innerHTML = ''
        if (!entries.length) {
          list.textContent = 'No markdown files'
          return
        }

        entries.forEach(entry => list.appendChild(renderFileTreeEntry(entry)))
      },
    )
  }

  function renderFileTreeEntry(entry: FileTreeEntry): HTMLElement {
    const item = document.createElement('li')
    item.className = `md-reader__file-tree-item md-reader__file-tree-item--${entry.type}`

    if (entry.type === 'directory') {
      const button = document.createElement('button')
      const childList = document.createElement('ul')
      childList.className = 'md-reader__file-tree-list'
      childList.hidden = true

      button.type = 'button'
      button.innerHTML = `<span class="md-reader__file-tree-caret">▸</span><span class="md-reader__file-tree-icon">□</span><span class="md-reader__file-tree-name"></span>`
      button.querySelector('.md-reader__file-tree-name').textContent =
        entry.name
      button.addEventListener('click', () => {
        const expanded = item.classList.toggle('expanded')
        childList.hidden = !expanded
        if (expanded && !childList.dataset.loaded) {
          childList.dataset.loaded = 'true'
          loadFileTreeDirectory(entry.url, childList)
        }
      })

      item.append(button, childList)
      return item
    }

    const link = document.createElement('a')
    link.href = entry.url
    link.innerHTML = `<span class="md-reader__file-tree-spacer"></span><span class="md-reader__file-tree-icon">M</span><span class="md-reader__file-tree-name"></span>`
    link.querySelector('.md-reader__file-tree-name').textContent = entry.name
    if (entry.url === window.location.href) {
      item.classList.add('active')
    }
    item.appendChild(link)
    return item
  }

  function isDotEntry(entry: FileTreeEntry): boolean {
    return entry.name.startsWith('.')
  }

  function renderOptionsMenu() {
    optionsMenu.innerHTML = `
      <div class="md-reader__options-title">Options</div>
      <label class="md-reader__options-row">
        <span>
          <strong>Hide dotfiles</strong>
          <small>Hide files and folders starting with a dot.</small>
        </span>
        <input type="checkbox" data-option="hideDotFiles" />
      </label>
      <div class="md-reader__options-group">
        <div class="md-reader__options-label">Theme</div>
        <div class="md-reader__options-theme">
          <button type="button" data-theme="light">Light</button>
          <button type="button" data-theme="dark">Dark</button>
          <button type="button" data-theme="auto">Auto</button>
        </div>
      </div>
    `

    const hideDotFiles = optionsMenu.query(
      '[data-option="hideDotFiles"]',
    ) as HTMLInputElement
    hideDotFiles.addEventListener('change', () => {
      saveConfig('hideDotFiles', hideDotFiles.checked)
    })

    optionsMenu.queryAll('[data-theme]').forEach(button => {
      button.addEventListener('click', () => {
        saveConfig('pageTheme', button.dataset.theme as Theme)
      })
    })

    updateOptionsMenuState()
  }

  function updateOptionsMenuState() {
    const hideDotFiles = optionsMenu.query(
      '[data-option="hideDotFiles"]',
    ) as HTMLInputElement
    if (hideDotFiles) {
      hideDotFiles.checked = !!configData.hideDotFiles
    }

    optionsMenu.queryAll('[data-theme]').forEach(button => {
      button.classList.toggle(
        'active',
        button.dataset.theme === configData.pageTheme,
      )
    })
  }

  function saveConfig(key: keyof Data, value: Data[keyof Data]) {
    chrome.runtime.sendMessage({ action: 'storage', data: { key, value } })
  }

  function handleHeadItem(
    eleList: HTMLElement[],
    head: HTMLElement,
  ): HTMLElement[] {
    const content = String(head.textContent).trim()
    const encodeContent = getDecodeContent(content)

    head.setAttribute('id', encodeContent)

    const headAnchor = new Ele<HTMLElement>('a', {
      className: className.HEAD_ANCHOR,
      href: `#${encodeContent}`,
    })
    headAnchor.textContent = '#'
    head.insertBefore(headAnchor.ele, head.firstChild)

    const link = new Ele<HTMLElement>('a', {
      title: content,
      href: `#${encodeContent}`,
    })
    link.textContent = content
    const li = new Ele<HTMLElement>('li', {
      className: `${className.MD_SIDE}-${head.tagName.toLowerCase()}`,
    })
    eleList.push(li.ele)
    li.append(link)
    df.append(li.ele)

    return eleList
  }

  function getDecodeContent(content: string): string {
    return (function unique(key: string): string {
      if (key in idCache) {
        return unique(`${key}-${idCache[key]++}`)
      } else {
        idCache[key] = 1
        return key
      }
    })(encodeURIComponent(content.toLowerCase().replace(/\s+/g, '-')))
  }

  function onScroll() {
    const documentScrollTop = document.documentElement.scrollTop
    goTopBtn.toggle(documentScrollTop >= 640)

    headElements.some((_, index) => {
      let sectionHeight = -20
      const item = headElements[index + 1]
      if (item) {
        sectionHeight += item.offsetTop
      }

      const hit = sectionHeight <= 0 || sectionHeight > documentScrollTop

      if (hit && (targetIndex !== index || reloading)) {
        let target = sideLiElements[targetIndex]
        target && target.classList.remove(className.MD_SIDE_ACTIVE)

        target = sideLiElements[(targetIndex = index)]
        if (target) {
          target.classList.add(className.MD_SIDE_ACTIVE)
          if (!isSideHover && target.scrollIntoView) {
            target.scrollIntoView({ block: 'nearest' })
          }
        }
      }
      return hit
    })
  }

  function renderContentByTheme(theme: Theme, prevTheme: Theme) {
    if (configData.mdPlugins.includes('Mermaid')) {
      if (theme === 'auto' || prevTheme === 'auto') {
        const themeScheme = getMediaQueryTheme()
        if (theme !== themeScheme && prevTheme !== themeScheme) {
          contentRender(mdRaw)
          renderSide()
        }
      } else {
        contentRender(mdRaw)
        renderSide()
      }
    }
  }

  function updateAnchorPosition() {
    if (window.location.hash) {
      setTimeout(() => {
        const hash = window.location.hash.slice(1)
        const target = headElements.find(head => {
          return head.getAttribute('id') === hash
        })
        if (target) {
          const top = target.offsetTop
          top && window.scrollTo(0, top)
        }
      })
    }
  }
}

storage.get().then(main)
