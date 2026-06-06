import React, { useRef, useEffect } from 'react';
import { renderWeaponSprite } from '../../lib/pixelArt/renderer';
import { Element, Manufacturer, WeaponType } from '../../types/game';

interface WeaponCanvasProps {
  type: WeaponType;
  manufacturer: Manufacturer;
  element: Element;
  rarity: string;
  size?: number;
  className?: string;
}

export const WeaponCanvas: React.FC<WeaponCanvasProps> = ({
  type,
  manufacturer,
  element,
  rarity,
  size = 64,
  className = '',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const loop = (time: number) => {
      renderWeaponSprite(canvas, type, manufacturer, element, rarity, time);
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);

    return () => cancelAnimationFrame(animRef.current);
  }, [type, manufacturer, element, rarity]);

  return (
    <canvas
      ref={canvasRef}
      width={64}
      height={64}
      className={`pixelated ${className}`}
      style={{ width: size, height: size, imageRendering: 'pixelated' }}
    />
  );
};
