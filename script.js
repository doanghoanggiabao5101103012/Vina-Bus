//================= 1. CẤU HÌNH =================
const CFG = {
  fileNode: "Vina_Bus/data/A..MapNode.txt",           // file đồ thị (id lat lon loại)
  tamBanDo: [10.7769, 106.7009],                       // tâm mở đầu: Quận 1
  zoom: 15,
  bien: { latMin: 10.7587, latMax: 10.7957, lonMin: 106.6839, lonMax: 106.7165 },  // vùng có dữ liệu
  nguongM: 300,                                        // cách node đi bộ gần nhất quá mức này thì từ chối
  mau: { dau: "gold", cuoi: "orange" },
};

//================= 2. TRẠNG THÁI =================
const state = {
  toaDoNode: [],          // toaDoNode[id] = [lat, lon]
  loaiNode: [],           // loaiNode[id]  = 0 (đường bộ) | 1 (trạm bus)
  dangGhim: null,         // "dau" | "cuoi" | null
  diem:   { dau: null, cuoi: null },   // mỗi điểm: { toaDo: [lat, lon], id, khoangCach }
  marker: { dau: null, cuoi: null },   // marker Leaflet tương ứng
};

//================= 3. THAM CHIẾU DOM =================
const $ = id => document.getElementById(id);
const el = {
  panel: $("panel"), btnToggle: $("btnToggle"),
  btnSwap: $("btnSwap"), btnTim: $("btnTim"), thongBao: $("thongBao"),
  input: { dau: $("input-dau"), cuoi: $("input-cuoi") },
  ghim:  { dau: $("ghim-dau"),  cuoi: $("ghim-cuoi") },
  hint:  { dau: $("hint-dau"),  cuoi: $("hint-cuoi") },
};

//================= 4. BẢN ĐỒ =================
const map = L.map("map", { zoomControl: false }).setView(CFG.tamBanDo, CFG.zoom);
L.control.zoom({ position: "topright" }).addTo(map);   // tránh bị bottom sheet che trên điện thoại
const laDienThoai = window.matchMedia("(max-width: 767px)");   // khớp breakpoint md của Tailwind
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19, attribution: "© OpenStreetMap contributors",
}).addTo(map);

//================= 5. ĐỌC DỮ LIỆU ĐỒ THỊ =================
async function napDoThi() {
  const text = await (await fetch(CFG.fileNode)).text();
  const dong = text.split(/\r?\n/).filter(l => l.trim() !== "");
  const n = Number(dong[0].split(" ")[0]);
  for (let i = 1; i <= n; i++) {
    const [id, lat, lon, loai] = dong[i].split(" ").map(Number);
    state.toaDoNode[id] = [lat, lon];
    state.loaiNode[id] = loai;
  }
}

//================= 6. TIỆN ÍCH TỌA ĐỘ =================
// "10.77, 106.70" -> [10.77, 106.70] ; sai định dạng -> null
function docToaDo(chuoi) {
  const p = chuoi.trim().split(/[,\s]+/).map(Number);
  return p.length === 2 && p.every(Number.isFinite) ? p : null;
}

function trongVung([lat, lon]) {
  const b = CFG.bien;
  return lat >= b.latMin && lat <= b.latMax && lon >= b.lonMin && lon <= b.lonMax;
}

function khoangCachM(a, b) {      // xấp xỉ phẳng, đủ chính xác ở quy mô thành phố
  const dx = (a[1] - b[1]) * 111320 * Math.cos(a[0] * Math.PI / 180);
  const dy = (a[0] - b[0]) * 110540;
  return Math.hypot(dx, dy);
}

// tọa độ -> id node đi bộ (loại 0) gần nhất
function timNodeGanNhat(toaDo) {
  let id = -1, min = Infinity;
  for (let i = 0; i < state.toaDoNode.length; i++) {
    if (state.loaiNode[i] !== 0) continue;
    const d = khoangCachM(toaDo, state.toaDoNode[i]);
    if (d < min) { min = d; id = i; }
  }
  return { id, khoangCach: min };
}

//================= 7. ĐẶT / HIỂN THỊ ĐIỂM =================
// trả về true nếu đặt thành công
function datDiem(loai, toaDo) {
  if (!trongVung(toaDo)) return baoLoi(loai, "Ngoài vùng có dữ liệu");
  const { id, khoangCach } = timNodeGanNhat(toaDo);
  if (khoangCach > CFG.nguongM) return baoLoi(loai, "Không có đường đi bộ gần vị trí này");
  state.diem[loai] = { toaDo, id, khoangCach };
  veDiem(loai);
  return true;
}

function baoLoi(loai, msg) {
  el.hint[loai].textContent = msg;
  el.hint[loai].classList.add("text-red-500");
  return false;
}

// vẽ lại input + gợi ý + marker của một điểm theo state
function veDiem(loai) {
  const d = state.diem[loai];
  if (state.marker[loai]) { map.removeLayer(state.marker[loai]); state.marker[loai] = null; }
  el.hint[loai].classList.remove("text-red-500");
  if (!d) { el.input[loai].value = ""; el.hint[loai].textContent = ""; return; }

  el.input[loai].value = d.toaDo[0].toFixed(6) + ", " + d.toaDo[1].toFixed(6);
  el.hint[loai].textContent = "→ node " + d.id + " (cách " + Math.round(d.khoangCach) + " m)";
  state.marker[loai] = L.circleMarker(d.toaDo, {
    radius: 9, color: "black", fillColor: CFG.mau[loai], fillOpacity: 1,
  }).bindTooltip(loai === "dau" ? "Điểm đầu" : "Điểm cuối").addTo(map);
}

//================= 8. CHẾ ĐỘ GHIM =================
function batGhim(loai) {
  const tat = state.dangGhim === loai;            // bấm lại lần nữa = hủy
  state.dangGhim = tat ? null : loai;
  for (const k of ["dau", "cuoi"]) el.ghim[k].classList.toggle("active", state.dangGhim === k);
  $("map").classList.toggle("dang-ghim", state.dangGhim !== null);
}

map.on("click", e => {
  if (!state.dangGhim) return;
  const loai = state.dangGhim;
  if (datDiem(loai, [e.latlng.lat, e.latlng.lng])) batGhim(loai);   // ghim xong tự thoát chế độ
});

//================= 9. SỰ KIỆN PANEL =================
// đóng/mở panel
// hướng trượt + mũi tên do style.css xử lý theo kích thước màn hình
el.btnToggle.onclick = () => el.panel.classList.toggle("dong");

// ghim + nhập tay
for (const loai of ["dau", "cuoi"]) {
  el.ghim[loai].onclick = () => batGhim(loai);
  el.input[loai].onchange = () => {
    const toaDo = docToaDo(el.input[loai].value);
    if (!toaDo) return baoLoi(loai, "Nhập dạng: vĩ độ, kinh độ");
    datDiem(loai, toaDo);
  };
}

// đổi chỗ điểm đầu và điểm cuối
el.btnSwap.onclick = () => {
  [state.diem.dau, state.diem.cuoi] = [state.diem.cuoi, state.diem.dau];
  veDiem("dau"); veDiem("cuoi");
};

// tìm đường
el.btnTim.onclick = () => {
  const { dau, cuoi } = state.diem;
  if (!dau || !cuoi) { el.thongBao.textContent = "Hãy chọn đủ điểm đầu và điểm cuối."; return; }
  // điện thoại: chừa thêm đáy bằng chiều cao bottom sheet (35%) để 2 điểm không bị che
  const chuaDay = laDienThoai.matches && !el.panel.classList.contains("dong") ? window.innerHeight * 0.35 : 0;
  map.fitBounds(L.latLngBounds([dau.toaDo, cuoi.toaDo]), {
    maxZoom: 17, paddingTopLeft: [60, 60], paddingBottomRight: [60, 60 + chuaDay],
  });
  timDuong(dau.id, cuoi.id);
};

//================= 10. TÌM ĐƯỜNG (chờ nối C++) =================
// TODO: gọi backend/C++ với (idDau, idCuoi), nhận ketqua.txt rồi vẽ bằng các hàm trong Vina_Bus/Main.html
function timDuong(idDau, idCuoi) {
  el.thongBao.textContent = "Tìm đường từ node " + idDau + " đến node " + idCuoi + "…";
  console.log("timDuong", idDau, idCuoi);
}

//================= 11. KHỞI ĐỘNG =================
napDoThi()
  .then(() => { el.thongBao.textContent = ""; })
  .catch(() => {
    el.thongBao.textContent = "Không tải được dữ liệu. Hãy chạy qua server (vd: python -m http.server) thay vì mở file trực tiếp.";
  });