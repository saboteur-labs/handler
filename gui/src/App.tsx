import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { RosterPage } from './pages/RosterPage';

export function App(): JSX.Element {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<RosterPage />} />
        <Route path="/agents/:identity" element={<div>Agent detail (coming soon)</div>} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
