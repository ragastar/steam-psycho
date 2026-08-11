"use client";

import { motion } from "framer-motion";

interface Tab {
  id: string;
  label: string;
  icon: string;
  isNew?: boolean;
}

interface TabNavigationProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  /**
   * Уголок справа от вкладок — сюда уезжает переключатель языка.
   *
   * Раньше он висел отдельно, поверх страницы (`absolute top-4 right-4 z-30`),
   * и накрывал собой правую вкладку: на телефоне до неё нельзя было
   * дотянуться вообще — нажатие всегда попадало в «RU». Поймано проверкой
   * вёрстки на ширине 390, вручную такое замечаешь, только если ткнёшь именно
   * в тот угол.
   */
  rightSlot?: React.ReactNode;
}

export function TabNavigation({ tabs, activeTab, onTabChange, rightSlot }: TabNavigationProps) {
  return (
    <div className="sticky top-0 z-30 bg-gray-950/90 backdrop-blur-md border-b border-gray-700/50">
      <div className="max-w-3xl mx-auto flex items-center gap-1 p-1.5 relative">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              /*
                min-w-0 здесь — главное. Без него flex-1 не позволяет кнопке
                сжаться уже своего содержимого, и три вкладки распирают строку:
                замерено на ширине 390 — страница становилась шире экрана на 94
                пикселя и уезжала вбок целиком, вместе с карточкой.

                Отступы и кегль на телефоне меньше: иначе подписи не влезают
                даже после того, как сжатие разрешено.
              */
              className={`min-w-0 flex-1 py-2.5 px-2 sm:px-4 text-xs sm:text-sm font-medium transition-all duration-200 relative rounded-lg ${
                isActive
                  ? "text-white"
                  : "text-gray-400 hover:text-gray-200 hover:bg-gray-800/50"
              }`}
            >
              {isActive && (
                <motion.div
                  layoutId="tab-glow"
                  className="absolute inset-0 rounded-lg bg-gradient-to-r from-purple-600/20 to-pink-600/20 shadow-[0_0_20px_rgba(168,85,247,0.15)]"
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
              )}
              <span className="relative z-10 flex items-center justify-center gap-1 sm:gap-1.5 min-w-0">
                <span className="shrink-0">{tab.icon}</span>
                <span className="truncate">{tab.label}</span>
                {/* Значок «новое» на телефоне прячем: он забирает ширину у
                    подписи, ради которой вкладка и существует. */}
                {tab.isNew && (
                  <span className="hidden sm:inline ml-1 px-1.5 py-0.5 text-[10px] font-bold uppercase rounded-full bg-gradient-to-r from-purple-500 to-pink-500 text-white leading-none">
                    NEW
                  </span>
                )}
              </span>
              {isActive && (
                <motion.div
                  layoutId="tab-indicator"
                  className="absolute bottom-0 left-2 right-2 h-0.5 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full"
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
              )}
            </button>
          );
        })}

        {rightSlot && <div className="shrink-0 pl-1">{rightSlot}</div>}
      </div>
    </div>
  );
}

export function TabContainer({ children, activeTab }: { children: React.ReactNode; activeTab: string }) {
  return (
    <motion.div
      key={activeTab}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      {children}
    </motion.div>
  );
}
