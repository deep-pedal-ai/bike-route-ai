import { Routes, Route } from "react-router-dom";
import Header from "./components/Header";
import GeneratePage from "./pages/GeneratePage";
import MapExplorer from "./pages/MapExplorer";
import ThemeProvider from "./theme/ThemeProvider";

export default function App() {
  return (
    <ThemeProvider>
      <div className="min-h-screen bg-[var(--color-forest)] text-[var(--color-ink)]">
        <Header />
        <Routes>
          <Route path="/" element={<GeneratePage />} />
          <Route path="/map" element={<MapExplorer />} />
        </Routes>
      </div>
    </ThemeProvider>
  );
}
