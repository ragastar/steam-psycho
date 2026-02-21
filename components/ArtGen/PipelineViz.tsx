interface PipelineVizProps {
  labels: {
    title: string;
    step1: string;
    step2: string;
    step3: string;
    step4: string;
  };
}

export function PipelineViz({ labels }: PipelineVizProps) {
  const steps = [
    { icon: "🎮", label: labels.step1 },
    { icon: "🧠", label: labels.step2 },
    { icon: "🎨", label: labels.step3 },
    { icon: "🖼️", label: labels.step4 },
  ];

  return (
    <div className="bg-gray-900/50 rounded-xl p-4 border border-gray-800">
      <h3 className="text-sm font-semibold text-gray-300 mb-4">{labels.title}</h3>
      <div className="flex items-center justify-between">
        {steps.map((step, i) => (
          <div key={i} className="flex items-center">
            <div className="flex flex-col items-center">
              <span className="text-2xl mb-1">{step.icon}</span>
              <span className="text-[10px] text-gray-500 text-center max-w-16">{step.label}</span>
            </div>
            {i < steps.length - 1 && (
              <div className="mx-2 text-gray-700">→</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
