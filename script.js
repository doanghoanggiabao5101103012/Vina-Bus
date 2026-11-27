//================= 1. CẤU HÌNH =================
const CFG = {
  fileNode:     "data/A..MapNode.txt",              // file đồ thị (id lat lon loại)
  fileDuongBus: "data/A..DườngĐiXeBus.txt",         // file đường xe bus chạy giữa hai trạm (để vẽ đường cong)
  fileTuyen:    "data/A..CácTuyếnXeBus.txt",        // file danh sách tuyến (id, số hiệu, tên)
  fileKetQua:   "data/A..ketqua.txt",               // file kết quả do C++ ghi
  tamBanDo: [10.7769, 106.7009],                       // tâm mở đầu: Quận 1
  zoom: 15,
  bien: { latMin: 10.7587, latMax: 10.7957, lonMin: 106.6839, lonMax: 106.7165 },  // vùng có dữ liệu
  nguongNodeM: 300,                                    // cách node đi bộ gần nhất quá mức này thì từ chối
  maDiBo: -1,                                          // trong file kết quả, route_id = -1 nghĩa là đoạn đi bộ (đặt tên để khỏi viết số -1 rải rác)
  mau: { dau: "gold", cuoi: "orange" },
};

//================= 2. TRẠNG THÁI =================
const state = {
  toaDoNode: [],          // toaDoNode[id] = [lat, lon]
  loaiNode: [],           // loaiNode[id]  = 0 (đường bộ) | 1 (trạm bus)
  duongBus: {},           // duongBus["tuyến_trạmĐi_trạmĐến"] = [[lat, lon], ...]
  tuyen: {},              // tuyen[route_id] = { soHieu, ten }
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
const lopKetQua = L.layerGroup().addTo(map);   // nhóm chứa mọi nét vẽ của kết quả; clearLayers() là xóa sạch kết quả cũ

//================= 5. ĐỌC DỮ LIỆU =================
//cắt nội dung file thành mảng các hàng, bỏ hàng trống
//split(/\r?\n/) tách theo xuống dòng (chịu được cả file Windows lẫn Linux); filter bỏ hàng rỗng
const tachHang = noiDung => noiDung.split(/\r?\n/).filter(hang => hang.trim() !== "");

//đọc A..MapNode.txt -> trả về { toaDoNode, loaiNode }  (toaDoNode[id] = [lat, lon], loaiNode[id] = 0 hoặc 1)
function docDoThi(noiDung) {
  const cacHang = tachHang(noiDung);            //cacHang là mảng hàng của file (cacHang[0] là hàng đầu "n m")
  const n = Number(cacHang[0].split(" ")[0]);   //số node cần đọc (số đầu tiên của hàng đầu)
  const toaDoNode = new Array(n), loaiNode = new Array(n);   //hai mảng n ô: tọa độ và loại, dùng id làm chỉ số
  for (let i = 1; i <= n; i++) {                //n hàng node, bắt đầu từ hàng 1 (hàng 0 là hàng đầu)
    const [id, lat, lon, loai] = cacHang[i].split(" ").map(Number);   //tách hàng thành id / vĩ độ / kinh độ / loại   --- split chỉ tách thành các string  --- map(Number) biến nó thành số
    toaDoNode[id] = [lat, lon];                 //lưu tọa độ node theo id
    loaiNode[id] = loai;                        //lưu loại node theo id (0 = đường bộ, 1 = trạm bus)
  }
  return { toaDoNode, loaiNode };
}

//đọc A..DườngĐiXeBus.txt -> trả về duongBus["tuyến_trạmĐi_trạmĐến"] = [[lat, lon], ...]
//mỗi khối gồm 1 hàng tiêu đề (tuyến, trạm đi, trạm đến, số điểm) + các hàng tọa độ các điểm xe đi qua
function docDuongBus(noiDung) {
  const cacHang = tachHang(noiDung), duongBus = {};
  let i = 0;
  while (i < cacHang.length) {                  //mỗi vòng đọc trọn một khối (khối dài soDiem + 1 hàng nên không dùng for được)
    const [maTuyen, tramDi, tramDen, soDiem] = cacHang[i++].split(" ").map(Number);   //hàng tiêu đề: maTuyen = tuyến xe bus / tramDi = trạm bắt đầu / tramDen = trạm tiếp theo liền kề / soDiem = số điểm đi qua
    const arr = [];                             //arr: mảng tọa độ [lat, lon] các điểm xe bus đi qua giữa trạm tramDi và tramDen (dùng để vẽ đường cong)
    for (let j = 0; j < soDiem; j++) arr.push(cacHang[i++].split(" ").map(Number));   //đọc đúng soDiem hàng tọa độ ngay sau hàng tiêu đề
    duongBus[maTuyen + "_" + tramDi + "_" + tramDen] = arr;   //cất vào theo khóa "tuyến_trạmĐi_trạmĐến"
  }
  return duongBus;
}

//đọc A..CácTuyếnXeBus.txt -> trả về tuyen[route_id] = { soHieu, ten }
function docTuyen(noiDung) {
  const cacHang = tachHang(noiDung);
  const tuyen = {};                             //đối tượng rỗng: khóa là route_id, giá trị là { soHieu, ten }
  for (let i = 0; i < cacHang.length; i++) {    //mỗi hàng là một tuyến (file này không có hàng đầu nên bắt đầu từ 0)
    const [id, soHieu, ten] = cacHang[i].split("\t");   //tách theo Tab thành route_id / số hiệu tuyến / tên tuyến (tên có dấu cách nên không tách bằng " ")
    tuyen[Number(id)] = { soHieu, ten };        //chỉ id mới đổi sang số, soHieu và ten vẫn là chữ
  }
  return tuyen;
}

//đọc A..ketqua.txt -> trả về [{ maTuyen, cacId, cacToaDo }]  (mỗi phần tử là một đoạn đường đi: đi bộ hoặc đi một tuyến bus)
//mỗi hàng của file có dạng "route_id id id id ...", route_id = -1 là đi bộ
function docKetQua(noiDung, toaDoNode, duongBus) {          //cần toaDoNode (tọa độ node) và duongBus (điểm đi qua giữa hai trạm) để đổi id thành tọa độ
  return tachHang(noiDung).map(hang => {                    //mỗi hàng của file biến thành một đoạn đường
    const [maTuyen, ...cacId] = hang.split(" ").map(Number);   //số đầu tiên là route_id, ...cacId gom tất cả số còn lại thành một mảng id
    let cacToaDo;                                           //danh sách tọa độ [lat, lon] của đoạn này, dùng để vẽ
    if (maTuyen === CFG.maDiBo) {                           //đoạn đi bộ
      cacToaDo = cacId.map(id => toaDoNode[id]);            //đổi từng id node sang tọa độ
    } else {                                                //đoạn đi bus
      cacToaDo = [toaDoNode[cacId[0]]];                     //bắt đầu từ tọa độ trạm lên xe
      for (let k = 0; k + 1 < cacId.length; k++) {          //đi qua từng cặp trạm liền kề (trạm k và trạm k+1)
        const mid = duongBus[maTuyen + "_" + cacId[k] + "_" + cacId[k + 1]];   //tra khóa "tuyến_trạmĐi_trạmĐến" để lấy các điểm xe chạy giữa hai trạm
        if (mid) cacToaDo.push(...mid);                     //nếu có thì thêm các điểm đó vào (... trải mảng ra từng phần tử); thiếu thì bỏ qua, đường sẽ nối thẳng hai trạm
        cacToaDo.push(toaDoNode[cacId[k + 1]]);             //thêm tọa độ trạm kế tiếp
      }
    }
    return { maTuyen, cacId, cacToaDo };                    //trả về đoạn này gồm tuyến, danh sách id, danh sách tọa độ
  });
}

//tải 3 file dữ liệu cố định lúc mở trang (kết quả thì tải riêng mỗi lần bấm Tìm đường)
async function napDuLieu() {
  const get = async f => (await fetch(f)).text();           //get: gửi yêu cầu lấy file f rồi trả về nội dung của nó dưới dạng chữ
  const [chuNode, chuDuongBus, chuTuyen] = await Promise.all(   //tải cả 3 file cùng lúc, chờ đủ cả 3 rồi mới đi tiếp
    [CFG.fileNode, CFG.fileDuongBus, CFG.fileTuyen].map(get));
  const g = docDoThi(chuNode);                              //chữ của file node -> tọa độ và loại các node
  state.toaDoNode = g.toaDoNode;
  state.loaiNode = g.loaiNode;
  state.duongBus = docDuongBus(chuDuongBus);                //chữ của file đường bus -> điểm đi qua giữa hai trạm
  state.tuyen = docTuyen(chuTuyen);                         //chữ của file tuyến -> số hiệu và tên tuyến
}

//================= 6. TIỆN ÍCH TỌA ĐỘ =================
// "10.77, 106.70" -> [10.77, 106.70] ; sai định dạng -> null
function docToaDo(chuoi) {
  // tách theo dấu phẩy hoặc khoảng trắng; filter(Boolean) bỏ chuỗi rỗng, nếu không "10.77," sẽ thành [10.77, 0] vì Number("") = 0
  const toaDo = chuoi.trim().split(/[,\s]+/).filter(Boolean).map(Number);
  return toaDo.length === 2 && toaDo.every(Number.isFinite) ? toaDo : null;
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
// vaiTro là "dau" hoặc "cuoi" (điểm đầu hay điểm cuối); trả về true nếu đặt thành công
function datDiem(vaiTro, toaDo) {
  // dữ liệu còn đang tải thì toaDoNode rỗng, timNodeGanNhat sẽ trả về khoảng cách Infinity
  // và báo nhầm "không có đường đi bộ gần đây", nên chặn sớm bằng thông báo đúng nguyên nhân
  if (state.toaDoNode.length === 0) return baoLoi(vaiTro, "Dữ liệu chưa tải xong");
  if (!trongVung(toaDo)) return baoLoi(vaiTro, "Ngoài vùng có dữ liệu");
  const { id, khoangCach } = timNodeGanNhat(toaDo);
  if (khoangCach > CFG.nguongNodeM) return baoLoi(vaiTro, "Không có đường đi bộ gần vị trí này");
  state.diem[vaiTro] = { toaDo, id, khoangCach };
  veDiem(vaiTro);
  return true;
}

function baoLoi(vaiTro, loiNhan) {
  el.hint[vaiTro].textContent = loiNhan;
  el.hint[vaiTro].classList.add("text-red-500");
  return false;
}

// vẽ lại input + gợi ý + marker của một điểm theo state
function veDiem(vaiTro) {
  const d = state.diem[vaiTro];
  if (state.marker[vaiTro]) { map.removeLayer(state.marker[vaiTro]); state.marker[vaiTro] = null; }
  el.hint[vaiTro].classList.remove("text-red-500");
  if (!d) { el.input[vaiTro].value = ""; el.hint[vaiTro].textContent = ""; return; }

  el.input[vaiTro].value = d.toaDo[0].toFixed(6) + ", " + d.toaDo[1].toFixed(6);
  el.hint[vaiTro].textContent = "→ node " + d.id + " (cách " + Math.round(d.khoangCach) + " m)";
  state.marker[vaiTro] = L.circleMarker(d.toaDo, {
    radius: 9, color: "black", fillColor: CFG.mau[vaiTro], fillOpacity: 1,
  }).bindTooltip(vaiTro === "dau" ? "Điểm đầu" : "Điểm cuối").addTo(map);
}

//================= 8. CHẾ ĐỘ GHIM =================
function batGhim(vaiTro) {
  const tat = state.dangGhim === vaiTro;            // bấm lại lần nữa = hủy
  state.dangGhim = tat ? null : vaiTro;
  for (const k of ["dau", "cuoi"]) el.ghim[k].classList.toggle("active", state.dangGhim === k);
  $("map").classList.toggle("dang-ghim", state.dangGhim !== null);
}

map.on("click", e => {
  if (!state.dangGhim) return;
  const vaiTro = state.dangGhim;
  if (datDiem(vaiTro, [e.latlng.lat, e.latlng.lng])) batGhim(vaiTro);   // ghim xong tự thoát chế độ
});

//================= 9. SỰ KIỆN PANEL =================
// đóng/mở panel
// hướng trượt + mũi tên do style.css xử lý theo kích thước màn hình
el.btnToggle.onclick = () => el.panel.classList.toggle("dong");

// ghim + nhập tay
for (const vaiTro of ["dau", "cuoi"]) {
  el.ghim[vaiTro].onclick = () => batGhim(vaiTro);
  el.input[vaiTro].onchange = () => {
    const toaDo = docToaDo(el.input[vaiTro].value);
    if (!toaDo) return baoLoi(vaiTro, "Nhập dạng: vĩ độ, kinh độ");
    datDiem(vaiTro, toaDo);
  };
}

// đổi chỗ điểm đầu và điểm cuối
el.btnSwap.onclick = () => {
  [state.diem.dau, state.diem.cuoi] = [state.diem.cuoi, state.diem.dau];   // hoán đổi hai giá trị không cần biến tạm
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
  hienKetQua();                                   // đọc file kết quả của C++ rồi vẽ
};

//================= 10. VẼ KẾT QUẢ =================
//vẽ một chấm xanh lá đánh dấu trạm xe buýt, rê chuột vào sẽ hiện nhãn
function veTram(toaDo, nhan) {
  L.circleMarker(toaDo, { radius: 7, color: "green", fillColor: "green", fillOpacity: 1 })
    .bindTooltip(nhan).addTo(lopKetQua);
}

//vẽ đoạn đi bộ: nét đỏ cùng các chấm nhỏ trên từng node
function veDiBo(doan) {
  L.polyline(doan.cacToaDo, { color: "red", weight: 4 }).addTo(lopKetQua);   //nét đỏ nối các điểm
  return "Đi bộ";                                                            //trả về chữ để ghi vào tóm tắt lộ trình
}

//vẽ đoạn đi xe buýt: nét xanh dương cùng trạm lên và trạm xuống
//không cần truyền tuyen và toaDoNode vào vì đã có sẵn trong state
function veXeBuyt(doan) {
  const tuyenXe = state.tuyen[doan.maTuyen] || { soHieu: doan.maTuyen, ten: "" };   //số hiệu và tên tuyến; không có trong file tuyến thì dùng tạm route_id
  const tramLen = doan.cacId[0], tramXuong = doan.cacId[doan.cacId.length - 1];     //trạm đầu và trạm cuối của đoạn
  const soChang = doan.cacId.length - 1;                                            //số chặng = số trạm trừ 1

  L.polyline(doan.cacToaDo, { color: "blue", weight: 5 })                           //nét xanh dương nối các điểm xe chạy
    .bindTooltip("Tuyến " + tuyenXe.soHieu + (tuyenXe.ten ? ": " + tuyenXe.ten : "")).addTo(lopKetQua);   //rê chuột vào hiện số hiệu và tên tuyến (không có tên thì khỏi hiện dấu ":")
  veTram(state.toaDoNode[tramLen], "Lên xe tuyến " + tuyenXe.soHieu + " (trạm " + tramLen + ")");
  veTram(state.toaDoNode[tramXuong], "Xuống xe (trạm " + tramXuong + ")");
  return "Xe buýt " + tuyenXe.soHieu + " (" + soChang + " chặng)";
}

//đọc A..ketqua.txt (C++ vừa ghi) rồi vẽ lên bản đồ; mỗi lần bấm Tìm đường là xóa kết quả cũ và vẽ lại
async function hienKetQua() {                                    //async để dùng được await (chờ tải file xong mới chạy tiếp)
  const noiDung = await (await fetch(CFG.fileKetQua, { cache: "no-store" })).text();   //cache: "no-store" = không dùng bản trình duyệt đã nhớ, luôn lấy bản mới nhất sau khi C++ ghi đè
  const cacDoan = docKetQua(noiDung, state.toaDoNode, state.duongBus);   //chữ của file kết quả -> các đoạn đường cần vẽ
  lopKetQua.clearLayers();                                       //xóa nét vẽ của lần trước
  if (cacDoan.length === 0) { el.thongBao.textContent = "Không tìm thấy đường đi."; return; }   //file rỗng: báo thay vì để ô thông báo trống
  const tomTat = cacDoan.map(doan =>                             //duyệt từng đoạn của lộ trình theo thứ tự
    doan.maTuyen === CFG.maDiBo ? veDiBo(doan) : veXeBuyt(doan));   //đi bộ hay đi xe buýt; hàm vẽ trả về chữ tóm tắt
  el.thongBao.textContent = tomTat.join(" → ");                  //ghi tóm tắt lộ trình vào ô thông báo, nối các phần bằng mũi tên
}

//================= 11. KHỞI ĐỘNG =================
napDuLieu()
  .then(() => { el.thongBao.textContent = ""; })
  .catch(() => {
    el.thongBao.textContent = "Không tải được dữ liệu. Hãy chạy qua server (vd: python -m http.server) thay vì mở file trực tiếp.";
  });