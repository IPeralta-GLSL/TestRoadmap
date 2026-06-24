import { useEffect, useState, useRef } from 'react';
import { TbUser, TbUsers } from 'react-icons/tb';
import { io, Socket } from 'socket.io-client';

interface PresenceIndicatorProps {
  isDark: boolean;
  textPrimary: string;
  cardBg: string;
  borderColor: string;
}

export default function PresenceIndicator({ isDark, textPrimary, cardBg, borderColor }: PresenceIndicatorProps) {
  const [peers, setPeers] = useState<any[]>([]);
  const socketRef = useRef<Socket | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [connectionStatus, setConnectionStatus] = useState<string>('Conectando...');
  const [isOpen, setIsOpen] = useState(false);

  const [myName, setMyName] = useState(() => localStorage.getItem('roadmapper-name') || '');
  const [myColor, setMyColor] = useState(() => localStorage.getItem('roadmapper-color') || '#4caf50');

  useEffect(() => {
    const socket: Socket = io(window.location.origin, {
      path: '/socket.io',
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setConnectionStatus('Conectado');
      const name = localStorage.getItem('roadmapper-name') || 'Usuario';
      const color = localStorage.getItem('roadmapper-color') || '#4caf50';
      socket.emit('presence:join', { name, color });
    });

    socket.on('presence:state', (list: any[]) => {
      setPeers(list);
    });

    socket.on('disconnect', () => {
      setConnectionStatus('Desconectado');
    });

    socket.on('error', () => {
      setConnectionStatus('Error');
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    const handle = setInterval(() => {
      if (socketRef.current?.connected) {
        socketRef.current.emit('presence:update', { lastSeen: new Date().toISOString() });
      }
    }, 5000);
    return () => clearInterval(handle);
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const updateMyProfile = (name: string, color: string) => {
    setMyName(name);
    setMyColor(color);
    localStorage.setItem('roadmapper-name', name);
    localStorage.setItem('roadmapper-color', color);
    if (socketRef.current?.connected) {
      socketRef.current.emit('presence:join', { name: name || 'Usuario', color });
    }
  };

  const statusColor = connectionStatus === 'Conectado' ? '#4caf50' : '#f44336';

  return (
    <div ref={dropdownRef} className="relative flex items-center">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="px-2.5 py-1 text-xs rounded hover:opacity-80 transition-colors flex items-center gap-1.5 font-medium border"
        style={{
          backgroundColor: isDark ? '#3a3a3a' : '#e0e0e0',
          color: textPrimary,
          borderColor: borderColor,
        }}
        title={`Estado: ${connectionStatus}`}
      >
        <div className="relative flex items-center justify-center">
          <TbUsers size={14} />
          <span className="absolute -top-1 -right-1 flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ backgroundColor: statusColor }}></span>
            <span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{ backgroundColor: statusColor }}></span>
          </span>
        </div>
        <span>{peers.length} {peers.length === 1 ? 'usuario' : 'usuarios'}</span>
      </button>

      {isOpen && (
        <div
          className="absolute left-0 top-full mt-1 z-50 border rounded-lg shadow-xl py-2 min-w-[210px]"
          style={{ backgroundColor: cardBg, borderColor }}
        >
          <div className="px-3 py-1 text-[10px] font-semibold tracking-wider border-b mb-1 uppercase" style={{ color: isDark ? '#888' : '#666', borderColor }}>
            Usuarios en línea ({peers.length})
          </div>
          <div className="max-h-[160px] overflow-y-auto custom-scrollbar">
            {peers.length === 0 ? (
              <div className="px-3 py-2 text-xs" style={{ color: isDark ? '#888' : '#666' }}>
                Nadie conectado
              </div>
            ) : (
              peers.map((p, idx) => {
                const displayName = p.name === 'Usuario' ? `Usuario ${idx + 1}` : (p.name || `Usuario ${idx + 1}`);
                const isMe = p.socketId === socketRef.current?.id;
                return (
                  <div key={p.socketId || idx} className="flex items-center gap-2 px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
                    <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${p.color || '#4caf50'}20` }}>
                      <TbUser size={12} style={{ color: p.color || '#4caf50' }} />
                    </div>
                    <div className="text-xs font-medium truncate flex-1" style={{ color: textPrimary }}>
                      {displayName}
                    </div>
                    {isMe && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold" style={{ backgroundColor: isDark ? '#1b5e20' : '#e8f5e9', color: isDark ? '#a5d6a7' : '#2e7d32' }}>
                        Tú
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>
          <div className="px-3 py-2 border-t mt-1.5 flex flex-col gap-1.5" style={{ borderColor }}>
            <div className="text-[10px] font-semibold uppercase" style={{ color: isDark ? '#888' : '#666' }}>
              Tu Perfil
            </div>
            <div className="flex gap-1.5">
              <input
                type="text"
                placeholder="Nombre..."
                className="px-2 py-1 text-xs border rounded outline-none flex-1"
                style={{ backgroundColor: isDark ? '#1a1a1a' : '#f5f5f5', color: textPrimary, borderColor }}
                value={myName}
                onChange={(e) => updateMyProfile(e.target.value, myColor)}
              />
              <input
                type="color"
                className="w-7 h-7 p-0 border rounded cursor-pointer flex-shrink-0 bg-transparent"
                style={{ borderColor }}
                value={myColor}
                onChange={(e) => updateMyProfile(myName, e.target.value)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
