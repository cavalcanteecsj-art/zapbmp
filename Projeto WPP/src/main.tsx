import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import InstancesPage from './pages/Instances';
import './index.css';

function Root() {
  const [hash, setHash] = React.useState(window.location.hash)
  React.useEffect(() => {
    const onHash = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const isInstances = hash === '#/instances'
  return (
    <React.StrictMode>
      <div className="p-3 border-b flex gap-3 items-center">
        <a href="#/" className="font-medium">Dashboard</a>
        <a href="#/instances" className="font-medium">Instâncias</a>
      </div>
      {isInstances ? <InstancesPage /> : <App />}
    </React.StrictMode>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(<Root />)
