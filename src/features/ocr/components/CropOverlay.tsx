import { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent } from '@/shared/components/ui/card';

interface Point {
  x: number;
  y: number;
}

interface Selection {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CropOverlayProps {
  screenshotBase64: string;
  onConfirm: (x: number, y: number, width: number, height: number) => void;
  onCancel: () => void;
  className?: string;
}

export function CropOverlay({
  screenshotBase64,
  onConfirm,
  onCancel,
  className,
}: CropOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [startPoint, setStartPoint] = useState<Point | null>(null);
  const [endPoint, setEndPoint] = useState<Point | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);

  const calculateSelection = useCallback((start: Point, end: Point): Selection => {
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    const width = Math.abs(end.x - start.x);
    const height = Math.abs(end.y - start.y);
    return { x, y, width, height };
  }, []);

  const getRelativeCoords = useCallback((e: React.MouseEvent): Point => {
    if (!containerRef.current) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const coords = getRelativeCoords(e);
    setStartPoint(coords);
    setEndPoint(coords);
    setIsSelecting(true);
    setSelection(null);
  }, [getRelativeCoords]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isSelecting || !startPoint) return;
    const coords = getRelativeCoords(e);
    setEndPoint(coords);
  }, [isSelecting, startPoint, getRelativeCoords]);

  const handleMouseUp = useCallback(() => {
    if (!isSelecting || !startPoint || !endPoint) return;
    setIsSelecting(false);

    const sel = calculateSelection(startPoint, endPoint);
    if (sel.width > 10 && sel.height > 10) {
      setSelection(sel);
    }
  }, [isSelecting, startPoint, endPoint, calculateSelection]);

  const mapSelectionToImagePixels = useCallback((sel: Selection): Selection | null => {
    const containerEl = containerRef.current;
    const imageEl = imageRef.current;
    if (!containerEl || !imageEl) return null;

    const { width: containerWidth, height: containerHeight } = containerEl.getBoundingClientRect();
    const naturalWidth = imageEl.naturalWidth;
    const naturalHeight = imageEl.naturalHeight;
    if (containerWidth <= 0 || containerHeight <= 0 || naturalWidth <= 0 || naturalHeight <= 0) {
      return null;
    }

    // Mirror object-cover geometry when mapping viewport coordinates back to source pixels.
    const scale = Math.max(containerWidth / naturalWidth, containerHeight / naturalHeight);
    const renderedWidth = naturalWidth * scale;
    const renderedHeight = naturalHeight * scale;
    const offsetX = (containerWidth - renderedWidth) / 2;
    const offsetY = (containerHeight - renderedHeight) / 2;

    const left = Math.max(0, Math.min(renderedWidth, sel.x - offsetX));
    const top = Math.max(0, Math.min(renderedHeight, sel.y - offsetY));
    const right = Math.max(0, Math.min(renderedWidth, sel.x + sel.width - offsetX));
    const bottom = Math.max(0, Math.min(renderedHeight, sel.y + sel.height - offsetY));

    const x = Math.max(0, Math.min(naturalWidth - 1, Math.round(left / scale)));
    const y = Math.max(0, Math.min(naturalHeight - 1, Math.round(top / scale)));
    const width = Math.max(1, Math.round((right - left) / scale));
    const height = Math.max(1, Math.round((bottom - top) / scale));

    return {
      x,
      y,
      width: Math.min(width, naturalWidth - x),
      height: Math.min(height, naturalHeight - y),
    };
  }, []);

  const confirmSelection = useCallback((sel: Selection) => {
    const mapped = mapSelectionToImagePixels(sel);
    if (!mapped) return;
    onConfirm(mapped.x, mapped.y, mapped.width, mapped.height);
  }, [mapSelectionToImagePixels, onConfirm]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selection) {
          setSelection(null);
          setStartPoint(null);
          setEndPoint(null);
        } else {
          onCancel();
        }
      } else if (e.key === 'Enter' && selection) {
        confirmSelection(selection);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selection, onCancel, confirmSelection]);

  const currentRect = isSelecting && startPoint && endPoint
    ? calculateSelection(startPoint, endPoint)
    : selection;

  const handleConfirm = useCallback(() => {
    if (selection) {
      confirmSelection(selection);
    }
  }, [selection, confirmSelection]);

  const handleRecrop = useCallback(() => {
    setSelection(null);
    setStartPoint(null);
    setEndPoint(null);
  }, []);

  return (
    <div
      ref={containerRef}
      className={cn(
        'fixed inset-0 cursor-crosshair select-none',
        className,
      )}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <img
        ref={imageRef}
        src={`data:image/png;base64,${screenshotBase64}`}
        alt="Screenshot"
        className="absolute inset-0 w-full h-full object-cover pointer-events-none"
        draggable={false}
      />

      <div className="absolute inset-0 bg-black/40 pointer-events-none" />

      {currentRect && currentRect.width > 0 && currentRect.height > 0 && (
        <>
          <div
            className="absolute pointer-events-none"
            style={{
              left: currentRect.x,
              top: currentRect.y,
              width: currentRect.width,
              height: currentRect.height,
              boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.4)',
              backgroundColor: 'transparent',
            }}
          />
          <div
            className="absolute border-2 border-primary pointer-events-none"
            style={{
              left: currentRect.x - 2,
              top: currentRect.y - 2,
              width: currentRect.width + 4,
              height: currentRect.height + 4,
            }}
          />
          {selection && (
            <>
              <div className="absolute w-3 h-3 bg-primary rounded-full pointer-events-none"
                style={{ left: selection.x - 6, top: selection.y - 6 }} />
              <div className="absolute w-3 h-3 bg-primary rounded-full pointer-events-none"
                style={{ left: selection.x + selection.width - 6, top: selection.y - 6 }} />
              <div className="absolute w-3 h-3 bg-primary rounded-full pointer-events-none"
                style={{ left: selection.x - 6, top: selection.y + selection.height - 6 }} />
              <div className="absolute w-3 h-3 bg-primary rounded-full pointer-events-none"
                style={{ left: selection.x + selection.width - 6, top: selection.y + selection.height - 6 }} />
            </>
          )}
        </>
      )}

      {selection && (
        <CropConfirmationSheet
          onConfirm={handleConfirm}
          onRecrop={handleRecrop}
        />
      )}
    </div>
  );
}

interface CropConfirmationSheetProps {
  onConfirm: () => void;
  onRecrop: () => void;
}

function CropConfirmationSheet({ onConfirm, onRecrop }: CropConfirmationSheetProps) {
  const { t } = useTranslation();

  return (
    <div
      className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 gap-2 pointer-events-auto"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <Card className="border-[var(--color-border)]">
        <CardContent className="flex items-center gap-2 p-2">
          <Button type="button" variant="outline" onClick={onRecrop}>
            {t('ocr.recrop')}
          </Button>
          <Button type="button" onClick={onConfirm}>
            {t('ocr.confirm')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
