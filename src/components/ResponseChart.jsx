import { useEffect, useRef } from 'react';
import { clamp } from '../physics';
import { REPLAY_DURATION_SECONDS } from '../scenarios';

function drawGrid(context, left, top, right, bottom) {
  context.save();
  context.strokeStyle = 'rgba(142, 168, 190, .09)';
  context.lineWidth = 1;
  for (let i = 0; i <= 5; i += 1) {
    const y = top + (bottom - top) * i / 5;
    context.beginPath(); context.moveTo(left, y); context.lineTo(right, y); context.stroke();
  }
  for (let i = 0; i <= 8; i += 1) {
    const x = left + (right - left) * i / 8;
    context.beginPath(); context.moveTo(x, top); context.lineTo(x, bottom); context.stroke();
  }
  context.restore();
}

export default function ResponseChart({ run, showError = false, className = '', id, playbackTime = null, animate = false, onTime }) {
  const canvasRef = useRef(null);
  const drawRef = useRef(null);
  const playbackRef = useRef(playbackTime);
  const onTimeRef = useRef(onTime);
  playbackRef.current = playbackTime;
  onTimeRef.current = onTime;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const draw = (timeLimit = playbackRef.current) => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      const context = canvas.getContext('2d');
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      const width = rect.width;
      const height = rect.height;
      context.clearRect(0, 0, width, height);
      const margin = { left: 34, right: 12, top: 14, bottom: 24 };
      drawGrid(context, margin.left, margin.top, width - margin.right, height - margin.bottom);
      context.font = '8px SFMono-Regular, Consolas, monospace';
      context.fillStyle = 'rgba(142, 168, 190, .5)';
      context.textAlign = 'right';
      [40, 20, 0, -20, -40].forEach((label, index) => {
        const y = margin.top + (height - margin.top - margin.bottom) * index / 4;
        context.fillText(`${label}°`, margin.left - 6, y + 3);
      });
      context.textAlign = 'center';
      for (let i = 0; i <= 8; i += 2) {
        const x = margin.left + (width - margin.left - margin.right) * i / 8;
        context.fillText(`${i}s`, x, height - 6);
      }
      if (!run?.points?.length) {
        context.fillStyle = 'rgba(142, 168, 190, .55)';
        context.font = '10px SFMono-Regular, Consolas, monospace';
        context.fillText('RUN YOUR CONTROLLER TO BEGIN', width / 2, height / 2);
        return;
      }

      const xFor = (point) => margin.left + point.time / 8 * (width - margin.left - margin.right);
      const yFor = (value) => margin.top + (40 - clamp(value, -40, 40)) / 80 * (height - margin.top - margin.bottom);
      const visiblePoints = timeLimit == null
        ? run.points
        : run.points.filter((point) => point.time <= timeLimit + 0.001);
      if (!visiblePoints.length) visiblePoints.push(run.points[0]);
      const plot = (key, color, dash = []) => {
        context.save();
        context.strokeStyle = color;
        context.lineWidth = key === 'actual' ? 2 : 1;
        context.setLineDash(dash);
        context.beginPath();
        visiblePoints.forEach((point, index) => {
          const x = xFor(point); const y = yFor(point[key]);
          if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
        });
        context.stroke();
        context.restore();
      };
      plot('target', 'rgba(190, 206, 218, .58)', [5, 5]);
      plot('actual', '#ff0096');
      if (showError) plot('error', 'rgba(255, 181, 71, .7)');

      if (timeLimit != null) {
        const point = visiblePoints[visiblePoints.length - 1];
        const x = xFor(point);
        const y = yFor(point.actual);
        context.save();
        context.strokeStyle = 'rgba(255, 255, 255, .22)';
        context.lineWidth = 1;
        context.beginPath(); context.moveTo(x, margin.top); context.lineTo(x, height - margin.bottom); context.stroke();
        context.fillStyle = '#ff0096';
        context.shadowColor = '#ff0096'; context.shadowBlur = 8;
        context.beginPath(); context.arc(x, y, 3.2, 0, Math.PI * 2); context.fill();
        context.restore();
      }
    };

    drawRef.current = draw;
    if (animate && run?.points?.length) playbackRef.current = 0;
    onTimeRef.current?.(0);
    draw();
    const observer = new ResizeObserver(() => draw());
    observer.observe(canvas);
    let animationFrame;
    let lastReported = -1;
    if (animate && run?.points?.length) {
      const startedAt = performance.now();
      const paint = (now) => {
        const replayMilliseconds = REPLAY_DURATION_SECONDS * 1000;
        playbackRef.current = ((now - startedAt) % replayMilliseconds) / replayMilliseconds * 8;
        draw(playbackRef.current);
        const reportStep = Math.floor(playbackRef.current * 10);
        if (reportStep !== lastReported) {
          lastReported = reportStep;
          onTimeRef.current?.(playbackRef.current);
        }
        animationFrame = requestAnimationFrame(paint);
      };
      animationFrame = requestAnimationFrame(paint);
    }
    return () => {
      observer.disconnect();
      if (animationFrame) cancelAnimationFrame(animationFrame);
      drawRef.current = null;
    };
  }, [run, showError, animate]);

  useEffect(() => {
    playbackRef.current = playbackTime;
    if (!animate) drawRef.current?.(playbackTime);
  }, [playbackTime, animate]);

  return <canvas ref={canvasRef} id={id || (showError ? 'code-chart' : 'learn-chart')} className={className} aria-label="PID response chart" />;
}
