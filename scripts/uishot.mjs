/**
 * Drive a running instance's renderer and screenshot it.
 *
 * Synthetic OS-level clicks do not reach an Electron window reliably, so this talks to the
 * renderer over the DevTools protocol instead: click by CSS selector, wait for what the click
 * was supposed to produce, then capture the page. Same mechanism a browser test would use.
 *
 *   pnpm demo                                     # in one terminal
 *   node scripts/uishot.mjs 9334 out.png "click:[title='Icon view']" "wait:table"
 *
 * Steps run in order:
 *   click:SELECTOR   click the first match
 *   text:TEXT        click the first element whose trimmed text is exactly TEXT
 *   wait:SELECTOR    wait for a match to appear
 *   sleep:MS
 *   eval:EXPRESSION  run arbitrary JS in the page
 */
const [portText, output = 'shot.png', ...steps] = process.argv.slice(2)
const port = Number(portText) || 9334

const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) =>
  response.json()
)
const page = targets.find((target) => target.type === 'page')
if (!page) throw new Error('No page target — is the app running with --remote-debugging-port?')

const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})

let nextId = 0
const pending = new Map()

socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  const waiter = pending.get(message.id)
  if (!waiter) return
  pending.delete(message.id)
  message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result)
})

function send(method, params = {}) {
  const id = ++nextId
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? 'evaluation failed')
  }
  return result.result.value
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(expression, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await evaluate(expression)) return
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${expression}`)
    await sleep(150)
  }
}

for (const step of steps) {
  const separator = step.indexOf(':')
  const kind = step.slice(0, separator)
  const argument = step.slice(separator + 1)

  console.log(`  ${kind}: ${argument}`)

  if (kind === 'click') {
    await evaluate(`
      (() => {
        const element = document.querySelector(${JSON.stringify(argument)})
        if (!element) throw new Error('no match for ${argument.replace(/'/g, "\\'")}')
        element.click()
        return true
      })()
    `)
  } else if (kind === 'text') {
    // Clickable elements first. A wrapping <li> has the same text and comes earlier in
    // document order, so matching on text alone clicks the container and nothing happens.
    await evaluate(`
      (() => {
        const wanted = ${JSON.stringify(argument)}
        const matches = (candidate) => candidate.textContent.trim() === wanted
        const element =
          [...document.querySelectorAll('button, a, input, [role="button"]')].find(matches) ??
          [...document.querySelectorAll('td, li, div, span')].find(matches)
        if (!element) throw new Error('no element with text ' + wanted)
        element.click()
        return true
      })()
    `)
  } else if (kind === 'dblclick') {
    await evaluate(`
      (() => {
        const element = document.querySelector(${JSON.stringify(argument)})
        if (!element) throw new Error('no match')
        element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
        return true
      })()
    `)
  } else if (kind === 'wait') {
    await waitFor(`Boolean(document.querySelector(${JSON.stringify(argument)}))`)
  } else if (kind === 'sleep') {
    await sleep(Number(argument))
  } else if (kind === 'eval') {
    console.log('   ->', await evaluate(argument))
  } else if (kind === 'evalfile') {
    const { readFileSync } = await import('node:fs')
    console.log('   ->', await evaluate(readFileSync(argument, 'utf8')))
  } else {
    throw new Error(`Unknown step ${kind}`)
  }

  await sleep(350)
}

const { data } = await send('Page.captureScreenshot', { format: 'png' })
const { writeFileSync } = await import('node:fs')
writeFileSync(output, Buffer.from(data, 'base64'))
console.log(`saved ${output}`)

socket.close()
process.exit(0)
