import { useState } from 'react';
import Head from 'next/head';
import ProductsTable from '../components/ProductsTable';
import ActivityMonitor from '../components/ActivityMonitor';

export default function ProductManager() {
  const [activeTab, setActiveTab] = useState('products');
  
  return (
    <div className="container">
      <Head>
        <title>Gestor de Productos - Kinguin MercadoLibre Reseller</title>
        <meta name="description" content="Gestión de productos y precios" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main className="main">
        <div className="header">
          <h1 className="title">Gestor de Productos</h1>
          
          <div className="tabs">
            <button 
              className={`tab ${activeTab === 'products' ? 'active' : ''}`}
              onClick={() => setActiveTab('products')}
            >
              Productos
            </button>
            <button 
              className={`tab ${activeTab === 'activity' ? 'active' : ''}`}
              onClick={() => setActiveTab('activity')}
            >
              Actividad
            </button>
          </div>
        </div>
        
        {activeTab === 'products' && (
          <section className="section">
            <ProductsTable />
          </section>
        )}
        
        {activeTab === 'activity' && (
          <section className="section">
            <ActivityMonitor />
          </section>
        )}
      </main>
      
      <style jsx>{`
        .container {
          padding: 0 1rem;
          max-width: 1400px;
          margin: 0 auto;
        }
        
        .main {
          padding: 2rem 0;
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }
        
        .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 1.5rem;
        }
        
        .title {
          font-size: 2rem;
          margin: 0;
          color: #2d3748;
        }
        
        .tabs {
          display: flex;
          gap: 0.5rem;
        }
        
        .tab {
          padding: 0.75rem 1.5rem;
          background: #edf2f7;
          border: none;
          border-radius: 0.5rem;
          font-size: 1rem;
          font-weight: 500;
          color: #4a5568;
          cursor: pointer;
          transition: all 0.2s;
        }
        
        .tab:hover {
          background: #e2e8f0;
        }
        
        .tab.active {
          background: #4299e1;
          color: white;
        }
        
        .section {
          width: 100%;
        }
        
        @media (max-width: 768px) {
          .header {
            flex-direction: column;
            align-items: flex-start;
            gap: 1rem;
          }
        }
      `}</style>
    </div>
  );
}