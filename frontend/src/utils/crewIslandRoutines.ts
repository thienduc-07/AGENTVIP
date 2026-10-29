export interface IslandRoutine {
  targetPos: [number, number, number];
  speech: string;
  activity: string;
  stayDuration: number;
}

export const CREW_ISLAND_ROUTINES: Record<string, IslandRoutine[]> = {
  "agent-captain-roger": [
    {
      targetPos: [-9.2, 2.55, 3.8],
      speech: "Sanji! Đói quá, mang đùi thịt nướng khổng lồ ra đây mau!",
      activity: "eating",
      stayDuration: 16,
    },
    {
      targetPos: [-6.5, 0.55, 7.5],
      speech: "Sunny ơi! Chuyến phiêu lưu tiếp theo sẽ tới hòn đảo nào đây nhỉ!",
      activity: "strolling",
      stayDuration: 14,
    },
    {
      targetPos: [-11.5, 2.85, -0.8],
      speech: "Chopper! Cậu có kẹo bông gòn mới chế không, cho ta ăn với!",
      activity: "strolling",
      stayDuration: 12,
    },
  ],

  "agent-zoro-quartermaster": [
    {
      targetPos: [-8.8, 2.55, 2.8],
      speech: "Này đầu bếp dở hơi, mang bình sake ngon nhất ra đây!",
      activity: "strolling",
      stayDuration: 14,
    },
    {
      targetPos: [-1.2, 1.82, 4.2],
      speech: "Ủa? Rõ ràng là đi thẳng mà... Lại đi lạc nữa rồi sao?!",
      activity: "strolling",
      stayDuration: 12,
    },
    {
      targetPos: [-12.2, 2.85, -1.2],
      speech: "Chopper, vết thương cũ hơi nhức, lấy cho ít băng gạc xem.",
      activity: "strolling",
      stayDuration: 15,
    },
  ],

  "agent-sanji-cook": [
    {
      targetPos: [8.8, 2.4, 1.2],
      speech: "Nami-swaaan! Trà quýt ướp đá mật ong ngọt ngào cho nàng đây~ Mellorine!",
      activity: "strolling",
      stayDuration: 15,
    },
    {
      targetPos: [17.5, 2.2, 0.2],
      speech: "Robin-chwan! Tách cà phê đen thơm nồng hảo hạng cho nàng đọc sách!",
      activity: "strolling",
      stayDuration: 15,
    },
    {
      targetPos: [-9.5, 2.55, 3.0],
      speech: "Luffy! Tay dính đầy mỡ thế kia mà dám thò vào nồi thịt à?!",
      activity: "cooking",
      stayDuration: 14,
    },
  ],

  "agent-chopper-doctor": [
    {
      targetPos: [5.5, 3.6, 10.5],
      speech: "Zoro ngốc! Đã bảo vết thương chưa lành thì không được vác tạ nặng cơ mà!",
      activity: "strolling",
      stayDuration: 15,
    },
    {
      targetPos: [-15.0, 2.9, -4.0],
      speech: "Hoa anh đào nở đẹp quá! Cảm giác như được trở về đảo tuyết Drum vậy!",
      activity: "strolling",
      stayDuration: 12,
    },
    {
      targetPos: [-12.5, 2.85, -1.0],
      speech: "Khen tớ tớ cũng chẳng vui vẻ gì đâu mà, đồ ngốc này~ (múa lượn)",
      activity: "strolling",
      stayDuration: 14,
    },
  ],

  "agent-nami-navigator": [
    {
      targetPos: [-7.0, 0.55, 8.0],
      speech: "Áp suất biển đang giảm, sắp có bão Grand Line, hạ buồm Sunny neo đậu cẩn thận!",
      activity: "strolling",
      stayDuration: 15,
    },
    {
      targetPos: [11.5, 2.4, 2.2],
      speech: "Quýt mùa này chín mọng rồi! Luffy mà dám hái trộm là tôi trừ sạch tiền ăn!",
      activity: "cartography",
      stayDuration: 14,
    },
  ],

  "agent-franky-shipwright": [
    {
      targetPos: [-6.0, 0.55, 7.0],
      speech: "SUUUUPER! Thân tàu gỗ Adam của Sunny vẫn cực kỳ cứng cáp và hoàn hảo!",
      activity: "super_pose",
      stayDuration: 16,
    },
    {
      targetPos: [10.5, 5.1, -4.8],
      speech: "Usopp! Bản thiết kế khẩu đại bác lò xo mới này hoạt động trên cả tuyệt vời!",
      activity: "ship_repair",
      stayDuration: 14,
    },
  ],

  "agent-usopp-sniper": [
    {
      targetPos: [10.5, 5.1, -4.8],
      speech: "Franky! Nhìn phát minh đạn Pop Green Hỏa Điểu Tinh mới chế của ta này!",
      activity: "sniper_scout",
      stayDuration: 15,
    },
    {
      targetPos: [-11.8, 2.85, -1.2],
      speech: "Chopper! Ta từng một mình bắn hạ vua biển dài 1000 dặm ở Biển Đông đấy!",
      activity: "sniper_scout",
      stayDuration: 14,
    },
  ],

  "agent-robin-archaeologist": [
    {
      targetPos: [-11.0, 2.85, -1.5],
      speech: "Cánh hoa anh đào rơi thật đẹp... Một buổi chiều Grand Line thật thanh bình.",
      activity: "strolling",
      stayDuration: 16,
    },
    {
      targetPos: [-2.5, 0.4, -2.0],
      speech: "Dưới chân thác nước dường như có tàn tích bia đá cổ đại từ Thế Kỷ Trống...",
      activity: "cien_fleurs",
      stayDuration: 15,
    },
  ],

  "agent-brook-musician": [
    {
      targetPos: [-8.8, 2.55, 3.5],
      speech: "Sanji-san! Cho tôi xin một tách hồng trà thơm nhé! Yohohoho!",
      activity: "strolling",
      stayDuration: 15,
    },
    {
      targetPos: [-7.5, 0.55, 7.8],
      speech: "Hôm nay tôi sẽ biểu diễn bản nhạc Binks no Sake cho cả băng cùng nghe! Yohohoho!",
      activity: "violin_concert",
      stayDuration: 16,
    },
  ],

  "agent-jinbe-helmsman": [
    {
      targetPos: [-10.0, 0.4, 10.5],
      speech: "Dòng hải lưu ngầm hôm nay chảy về hướng Đông, rất thuận buồm xuôi gió.",
      activity: "karate_kata",
      stayDuration: 15,
    },
    {
      targetPos: [0.5, 2.6, 2.0],
      speech: "Thuyền trưởng Luffy, ta đã kiểm tra xong toàn bộ bãi đá quanh đảo.",
      activity: "karate_kata",
      stayDuration: 14,
    },
  ],
};
