import { useState, useEffect } from 'react';
import type { Route } from '@bike-route-ai/shared';

export default function App() {
  const [routes, setRoutes] = useState<Route[]>([]);

  useEffect(() => {
    const fetchRoutes = async () => {
      const res = await fetch('/api/routes');
      const data = await res.json();
      setRoutes(data.routes);
    };
    fetchRoutes();
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-6">Bike Route AI</h1>
      <ul className="space-y-2">
        {routes.map((route) => (
          <li key={route.id} className="bg-white rounded-lg p-4 shadow-sm">
            <span className="font-medium">{route.name}</span>
            <span className="text-gray-500 ml-2">{route.distance} km</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
