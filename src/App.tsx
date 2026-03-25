import { BrowserRouter, Routes, Route } from 'react-router-dom';
import MainPage from '@/features/main/pages/MainPage';
import LookupPage from '@/features/lookup/pages/LookupPage';
import TranslatePage from '@/features/translate/pages/TranslatePage';
import OCRPage from '@/features/ocr/pages/OCRPage';
import { Toaster } from '@/shared/components/ui/toaster';

function App() {
  return (
    <>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<MainPage />} />
          <Route path="/lookup" element={<LookupPage />} />
          <Route path="/translate" element={<TranslatePage />} />
          <Route path="/ocr" element={<OCRPage />} />
        </Routes>
      </BrowserRouter>
      <Toaster />
    </>
  );
}

export default App;
