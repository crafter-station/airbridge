import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'
import './styles.css'

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root')

// The toolbar has to leave room for whichever window controls the OS draws into it, and only
// the main process knows which platform this is.
void window.airbridge.getAppInfo().then((info) => {
  document.body.classList.add(`platform-${info.platform}`)
})

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
)
