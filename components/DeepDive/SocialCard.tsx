import type { AggregatedProfile } from "@/lib/aggregation/types";

interface SocialCardProps {
  social: AggregatedProfile["social"];
  labels: {
    title: string;
    friends: string;
    perYear: string;
    oldestFriend: string;
    noData: string;
  };
}

export function SocialCard({ social, labels }: SocialCardProps) {
  if (social.friendsCount === 0) {
    return (
      <div className="bg-gray-900/50 rounded-xl p-4 border border-gray-800">
        <h3 className="text-sm font-semibold text-gray-300 mb-2">{labels.title}</h3>
        <p className="text-xs text-gray-600">{labels.noData}</p>
      </div>
    );
  }

  const oldestDate = social.oldestFriend
    ? new Date(social.oldestFriend.since * 1000).toLocaleDateString()
    : null;

  return (
    <div className="bg-gray-900/50 rounded-xl p-4 border border-gray-800">
      <h3 className="text-sm font-semibold text-gray-300 mb-3">{labels.title}</h3>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs text-gray-500">{labels.friends}</p>
          <p className="text-lg font-bold font-mono text-white">{social.friendsCount}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">{labels.perYear}</p>
          <p className="text-lg font-bold font-mono text-white">{social.friendsAddedPerYear}</p>
        </div>
        {oldestDate && (
          <div className="col-span-2">
            <p className="text-xs text-gray-500">{labels.oldestFriend}</p>
            <p className="text-sm text-gray-300 font-mono">{oldestDate}</p>
          </div>
        )}
      </div>
    </div>
  );
}
