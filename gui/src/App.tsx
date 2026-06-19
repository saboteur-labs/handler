import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { RosterPage } from './pages/RosterPage';
import { AgentDetailPage } from './pages/AgentDetailPage';

export function App(): JSX.Element {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<RosterPage />} />
        <Route path="/agents/:identity" element={<AgentDetailPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
