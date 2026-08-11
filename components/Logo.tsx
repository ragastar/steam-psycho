/**
 * Знак сайта — стрелочный прибор со стрелкой в красной зоне.
 *
 * Тот же рисунок, что в иконке вкладки (app/icon.svg). Держим копию отдельным
 * компонентом, а не подключаем файл картинкой: так знак наследует цвет темы,
 * не даёт отдельного запроса и не мигает при загрузке страницы.
 *
 * Размер задаётся снаружи классами, поэтому своей ширины и высоты нет.
 */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="logo-scale" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#22d3ee" />
          <stop offset="0.55" stopColor="#a78bfa" />
          <stop offset="1" stopColor="#ec4899" />
        </linearGradient>
      </defs>
      <path
        d="M 6.5 22 A 9.5 9.5 0 0 1 25.5 22"
        fill="none"
        stroke="url(#logo-scale)"
        strokeWidth="3.4"
        strokeLinecap="round"
      />
      <path d="M 16 22 L 23.2 16.4" fill="none" stroke="#ec4899" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="16" cy="22" r="2.4" fill="#ec4899" />
    </svg>
  );
}
