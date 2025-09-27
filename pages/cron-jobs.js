import { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import CronJobManager from '../components/CronJobManager';

export default function CronJobsPage() {
  const [authorized, setAuthorized] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  
  const CORRECT_PASSWORD = process.env.NEXT_PUBLIC_PANEL_CLAVE || "oskar123";
  
  const handleLogin = (e) => {
    e.preventDefault();
    if (password === CORRECT_PASSWORD) {
      setAuthorized(true);
      setError('');
    } else {
      setError('Clave incorrecta. Intenta nuevamente.');
      setPassword('');
    }
  };
  
  if (!authorized) {
    return (
      <>
        <Head>
          <title>Gestor de Tareas Programadas - Kinguin MercadoLibre Reseller</title>
          <meta name="description" content="Gestión de tareas programadas para sincronización automática de productos" />
          <link rel="icon" href="/favicon.ico" />
        </Head>
        
        <div className="login-container">
          <div className="login-card">
            <h1 className="login-title">🕒 Tareas Programadas</h1>
            <p className="login-subtitle">Ingresa tus credenciales para continuar</p>
            
            <form className="login-form" onSubmit={handleLogin}>
              <div className="input-group">
                <span className="input-icon">🔒</span>
                <input
                  type="password"
                  className="login-input"
                  placeholder="Ingresa la clave de acceso"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus
                />
              </div>
              
              {error && <div className="error-message">{error}</div>}
              
              <button type="submit" className="login-button">
                Acceder al Panel
              </button>
            </form>
          </div>
        </div>
        
        <style jsx>{`
          .login-container {
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            padding: 20px;
          }
          
          .login-card {
            background: white;
            border-radius: 20px;
            padding: 40px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
            width: 100%;
            max-width: 400px;
            animation: slideUp 0.4s ease-out;
          }
          
          @keyframes slideUp {
            from {
              opacity: 0;
              transform: translateY(30px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
          
          .login-title {
            font-size: 28px;
            font-weight: bold;
            margin-bottom: 10px;
            text-align: center;
            color: #2d3748;
          }
          
          .login-subtitle {
            color: #718096;
            text-align: center;
            margin-bottom: 30px;
            font-size: 14px;
          }
          
          .login-form {
            display: flex;
            flex-direction: column;
            gap: 20px;
          }
          
          .input-group {
            position: relative;
          }
          
          .login-input {
            width: 100%;
            padding: 12px 15px 12px 45px;
            border: 2px solid #e2e8f0;
            border-radius: 10px;
            font-size: 16px;
            transition: all 0.3s;
            outline: none;
          }
          
          .login-input:focus {
            border-color: #667eea;
            box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
          }
          
          .input-icon {
            position: absolute;
            left: 15px;
            top: 50%;
            transform: translateY(-50%);
            font-size: 20px;
          }
          
          .login-button {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            padding: 14px;
            border-radius: 10px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: transform 0.2s, box-shadow 0.2s;
          }
          
          .login-button:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 20px rgba(102, 126, 234, 0.3);
          }
          
          .login-button:active {
            transform: translateY(0);
          }
          
          .error-message {
            background: #fed7d7;
            color: #c53030;
            padding: 10px 15px;
            border-radius: 8px;
            font-size: 14px;
            text-align: center;
            animation: shake 0.5s;
          }
          
          @keyframes shake {
            0%, 100% { transform: translateX(0); }
            25% { transform: translateX(-5px); }
            75% { transform: translateX(5px); }
          }
          
          @media (max-width: 480px) {
            .login-card {
              padding: 30px 20px;
            }
          }
        `}</style>
      </>
    );
  }

  return (
    <div className="container">
      <Head>
        <title>Gestor de Tareas Programadas - Kinguin MercadoLibre Reseller</title>
        <meta name="description" content="Gestión de tareas programadas para sincronización automática de productos" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <header className="header">
        <div className="header-content">
          <h1>🕒 Gestor de Tareas Programadas</h1>
          <p>Configura y administra la sincronización automática de productos</p>
        </div>
        
        <div className="nav-buttons">
          <Link href="/" className="nav-button">
            🏠 Inicio
          </Link>
          <Link href="/product-manager" className="nav-button">
            📊 Gestor de Productos
          </Link>
          <button 
            className="logout-button"
            onClick={() => {
              setAuthorized(false);
              setPassword('');
            }}
          >
            🚪 Cerrar Sesión
          </button>
        </div>
      </header>

      <main className="main">
        <CronJobManager />
        
        <div className="info-cards">
          <div className="info-card">
            <div className="info-icon">📝</div>
            <div className="info-content">
              <h3>Instrucciones</h3>
              <p>
                Configura los horarios de ejecución automática para mantener sincronizados tus productos. 
                Las tareas se ejecutarán según el horario establecido sin intervención manual.
              </p>
            </div>
          </div>
          
          <div className="info-card">
            <div className="info-icon">⚠️</div>
            <div className="info-content">
              <h3>Importante</h3>
              <p>
                Para que las tareas programadas funcionen correctamente, el servidor de cronjobs 
                debe estar en ejecución. Usa el comando <code>node scripts/cron-server.js</code> o configura un proceso PM2.
              </p>
            </div>
          </div>
        </div>
      </main>
      
      <style jsx>{`
        .container {
          min-height: 100vh;
          background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
        }
        
        .header {
          background: white;
          padding: 20px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 20px;
        }
        
        .header-content h1 {
          font-size: 24px;
          margin: 0 0 5px 0;
          color: #2d3748;
        }
        
        .header-content p {
          margin: 0;
          color: #718096;
        }
        
        .nav-buttons {
          display: flex;
          gap: 10px;
        }
        
        .nav-button {
          background: #edf2f7;
          color: #4a5568;
          padding: 8px 16px;
          border-radius: 6px;
          font-size: 14px;
          text-decoration: none;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          gap: 5px;
        }
        
        .nav-button:hover {
          background: #e2e8f0;
        }
        
        .logout-button {
          background: #fff5f5;
          color: #e53e3e;
          border: none;
          padding: 8px 16px;
          border-radius: 6px;
          font-size: 14px;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          gap: 5px;
        }
        
        .logout-button:hover {
          background: #fed7d7;
        }
        
        .main {
          max-width: 1200px;
          margin: 30px auto;
          padding: 0 20px;
        }
        
        .info-cards {
          margin-top: 30px;
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 20px;
        }
        
        .info-card {
          background: white;
          border-radius: 12px;
          padding: 20px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
          display: flex;
          gap: 15px;
        }
        
        .info-icon {
          font-size: 30px;
          color: #4a5568;
        }
        
        .info-content h3 {
          margin: 0 0 10px 0;
          font-size: 18px;
          color: #2d3748;
        }
        
        .info-content p {
          margin: 0;
          font-size: 14px;
          color: #4a5568;
          line-height: 1.5;
        }
        
        .info-content code {
          background: #edf2f7;
          padding: 2px 6px;
          border-radius: 4px;
          font-family: monospace;
          color: #4a5568;
          font-size: 12px;
        }
        
        @media (max-width: 768px) {
          .header {
            flex-direction: column;
            align-items: flex-start;
          }
          
          .nav-buttons {
            width: 100%;
            flex-wrap: wrap;
          }
          
          .nav-button, .logout-button {
            flex: 1;
            justify-content: center;
          }
        }
      `}</style>
    </div>
  );
}