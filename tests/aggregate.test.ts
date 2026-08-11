import { describe, it, expect } from "vitest";
import { buildAggregatedProfile } from "@/lib/aggregation/aggregate";
import {
  player,
  game,
  bareGame,
  friend,
  noBadges,
  noAchievements,
  noRecent,
  YEAR,
} from "./fixtures";

function build(over: {
  p?: ReturnType<typeof player>;
  games?: ReturnType<typeof game>[];
  recent?: typeof noRecent;
  friends?: ReturnType<typeof friend>[];
}) {
  return buildAggregatedProfile(
    over.p ?? player(),
    over.games ?? [game()],
    over.recent ?? noRecent,
    10,
    over.friends ?? [],
    noBadges,
    noAchievements,
  );
}

describe("платформы (DATA-1, DATA-6)", () => {
  it("учитывает время на macOS, а не выбрасывает его", () => {
    const profile = build({
      games: [
        game({
          playtime_forever: 200,
          playtime_windows_forever: 100,
          playtime_mac_forever: 100,
          playtime_linux_forever: 0,
        }),
      ],
    });

    expect(profile.platforms.macPercentage).toBe(50);
    expect(profile.platforms.windowsPercentage).toBe(50);
  });

  it("не выдумывает долю Steam Deck из времени на Linux", () => {
    const profile = build({
      games: [
        game({
          playtime_forever: 100,
          playtime_windows_forever: 0,
          playtime_linux_forever: 100,
        }),
      ],
    });

    // Всё время на Linux — значит 100% Linux, без отщипывания 30% в пользу Deck.
    expect(profile.platforms.linuxPercentage).toBe(100);
    expect(profile.platforms).not.toHaveProperty("deckPercentage");
  });

  it("проценты платформ складываются в 100", () => {
    const profile = build({
      games: [
        game({
          playtime_forever: 300,
          playtime_windows_forever: 100,
          playtime_mac_forever: 100,
          playtime_linux_forever: 100,
        }),
      ],
    });
    const { windowsPercentage, macPercentage, linuxPercentage } = profile.platforms;
    expect(windowsPercentage + macPercentage + linuxPercentage).toBe(100);
  });
});

describe("таймлайн (DATA-2, DATA-7)", () => {
  it("не содержит выдуманных пиковых часов", () => {
    const profile = build({});
    expect(profile.timeline).not.toHaveProperty("peakMonthlyHours");
    expect(profile.timeline).not.toHaveProperty("peakYear");
  });

  it("не объявляет рост, когда дата регистрации скрыта", () => {
    const profile = build({
      p: player({ timecreated: undefined }),
      games: [game({ playtime_forever: 6000 })],
      recent: [
        { appid: 1, name: "Test Game", playtime_forever: 6000, playtime_2weeks: 60, img_icon_url: "i" },
      ],
    });

    // Без возраста аккаунта сравнивать не с чем — «рост» был бы выдумкой.
    expect(profile.timeline.trend).toBe("unknown");
  });

  it("видит спад, когда недавняя активность заметно ниже обычной", () => {
    const profile = build({
      p: player({ timecreated: Math.floor(Date.now() / 1000 - 10 * YEAR) }),
      games: [game({ playtime_forever: 60000 })], // 1000 ч за 10 лет ≈ 8.3 ч/мес
      recent: [
        { appid: 1, name: "Test Game", playtime_forever: 60000, playtime_2weeks: 30, img_icon_url: "i" },
      ], // 0.5 ч за 2 недели → 1 ч/мес
    });

    expect(profile.timeline.trend).toBe("declining");
  });
});

describe("паттерны (DATA-5)", () => {
  it("считает долю инди от игр с известными жанрами, а не от всей библиотеки", () => {
    // 2 игры с данными (одна инди) + 98 игр без данных, как за пределами топ-30.
    const games = [
      game({ appid: 1, genres: ["Indie"], tags: { Indie: 100 } }),
      game({ appid: 2, genres: ["Action"], tags: { Action: 100 } }),
      ...Array.from({ length: 98 }, (_, i) => bareGame({ appid: 100 + i })),
    ];

    const profile = build({ games });

    // 1 инди из 2 игр с данными = 50%, а не 1 из 100 = 1%.
    expect(profile.patterns.indiePercentage).toBe(50);
  });

  it("отдаёт ноль, если данных о жанрах нет вообще", () => {
    const profile = build({ games: [bareGame({ appid: 1 }), bareGame({ appid: 2 })] });
    expect(profile.patterns.indiePercentage).toBe(0);
  });
});

describe("друзья (DATA-8)", () => {
  it("игнорирует нулевую дату дружбы вместо друга из 1970 года", () => {
    const real = Math.floor(Date.now() / 1000 - 2 * YEAR);
    const profile = build({
      friends: [
        friend({ steamid: "1", friend_since: 0 }),
        friend({ steamid: "2", friend_since: real }),
      ],
    });

    expect(profile.social.oldestFriend?.since).toBe(real);
    expect(profile.social.friendsCount).toBe(2);
  });

  it("не выдаёт абсурдный темп добавления друзей при нулевых датах", () => {
    const profile = build({
      friends: [friend({ steamid: "1", friend_since: 0 }), friend({ steamid: "2", friend_since: 0 })],
    });

    // Дат нет — темп посчитать не из чего.
    expect(profile.social.friendsAddedPerYear).toBe(0);
    expect(profile.social.oldestFriend).toBeNull();
  });
});

describe("экономика (DATA-9)", () => {
  it("не показывает цену часа для игр с ничтожным временем", () => {
    const profile = build({
      games: [game({ appid: 1, name: "Dropped", price: 60, playtime_forever: 6 })], // 0.1 ч
    });

    const top = profile.topGames.find((g) => g.appid === 1);
    expect(top?.pricePerHour).toBeUndefined();
  });

  it("показывает цену часа, когда времени достаточно", () => {
    const profile = build({
      games: [game({ appid: 1, name: "Played", price: 60, playtime_forever: 600 })], // 10 ч
    });

    const top = profile.topGames.find((g) => g.appid === 1);
    expect(top?.pricePerHour).toBe(6);
  });
});
