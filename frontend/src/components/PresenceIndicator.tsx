import { useEffect, useState, useRef } from 'react';
import { TbUser } from 'react-icons/tb';
import { io, Socket } from 'socket.io-client';

export default function PresenceIndicator() {
  const [peers, setPeers] = useState<any[]>([]);
  const socketRef = useRef<Socket | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<string>('Conectando...');

  useEffect(() => {
    console.log('[PresenceIndicator] Inicializando conexión socket.io...');
    
    const socket: Socket = io(window.location.origin, {
      path: '/socket.io',
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('[PresenceIndicator] ✓ Conectado:', socket.id);
      setConnectionStatus('Conectado');
      const name = localStorage.getItem('roadmapper-name') || 'Usuario';
      const color = localStorage.getItem('roadmapper-color') || '#2196f3';
      socket.emit('presence:join', { name, color });
      console.log('[PresenceIndicator] Emitiendo presence:join', { name, color });
    });

    socket.on('presence:state', (list: any[]) => {
      console.log('[PresenceIndicator] presence:state recibido:', list);
      setPeers(list);
    });

    socket.on('disconnect', () => {
      console.log('[PresenceIndicator] Desconectado');
      setConnectionStatus('Desconectado');
    });

    socket.on('error', (err: any) => {
      console.error('[PresenceIndicator] Error de socket:', err);
      setConnectionStatus('Error');
    });

    return () => {
      console.log('[PresenceIndicator] Limpiando socket');
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

  return (
    <div className="flex items-center gap-2">
      <div className="text-xs px-2 py-1 rounded" style={{ backgroundColor: '#f0f0f0', color: '#666' }}>
        {connectionStatus} ({peers.length})
      </div>
      {peers.slice(0, 5).map((p, i) => (
        <div key={p.socketId} className="flex items-center gap-1 px-2 py-0.5 rounded-full border" style={{ borderColor: 'rgba(0,0,0,0.06)', backgroundColor: '#fff' }}>
          <TbUser style={{ color: p.color || '#2196f3', width: 16, height: 16 }} />
          <div className="text-xs font-medium">{`Anonimo ${i + 1}`}</div>
        </div>
      ))}
      {peers.length > 5 && <div className="text-xs text-gray-500">+{peers.length - 5}</div>}
    </div>
  );
}
