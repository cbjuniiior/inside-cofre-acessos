import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import BrowserChrome from './screens/BrowserChrome'
import './index.css'

const isBrowserShell = new URLSearchParams(window.location.search).get('view') === 'browser'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>{isBrowserShell ? <BrowserChrome /> : <App />}</React.StrictMode>
)
