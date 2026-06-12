import { Routes, Route } from 'react-router-dom';
import Header from './components/Header';
import GeneratePage from './pages/GeneratePage';
import MapExplorer from './pages/MapExplorer';

export default function App() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <Header />
      <Routes>
        <Route path="/" element={<GeneratePage />} />
        <Route path="/map" element={<MapExplorer />} />
      </Routes>
    </div>
  );
}
