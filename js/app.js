const STORAGE_KEY = "agodaTicketFlow";

function loadBooking() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveBooking(patch) {
  const next = { ...loadBooking(), ...patch };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

function formatDate(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${month}/${day}/${date.getFullYear()}`;
}

function parseDate(value) {
  const match = String(value || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const date = new Date(Number(match[3]), Number(match[1]) - 1, Number(match[2]));
  if (date.getFullYear() !== Number(match[3]) || date.getMonth() !== Number(match[1]) - 1 || date.getDate() !== Number(match[2])) {
    return null;
  }
  return date;
}

function sameDay(a, b) {
  return a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

let airportsCache = null;
let airportsLoad = null;

function loadAirports() {
  if (airportsCache) return Promise.resolve(airportsCache);
  if (!airportsLoad) {
    airportsLoad = fetch("data/airports.json")
      .then((res) => {
        if (!res.ok) throw new Error("lookup failed");
        return res.json();
      })
      .then((data) => {
        airportsCache = Array.isArray(data) ? data : [];
        return airportsCache;
      })
      .catch((err) => {
        airportsLoad = null;
        throw err;
      });
  }
  return airportsLoad;
}

function airportLabel(place) {
  return place.city ? `${place.city} (${place.iata})` : place.iata;
}

function matchAirports(airports, query) {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];

  const scored = [];
  for (const place of airports) {
    const city = (place.city || "").toLowerCase();
    const name = (place.name || "").toLowerCase();
    const iata = (place.iata || "").toLowerCase();
    let score = -1;
    if (iata === q) score = 0;
    else if (city === q) score = 1;
    else if (city.startsWith(q)) score = 2;
    else if (iata.startsWith(q)) score = 3;
    else if (name.startsWith(q)) score = 4;
    else if (q.length >= 4 && city.includes(q)) score = 5;
    else if (q.length >= 4 && (name.includes(q) || iata.includes(q))) score = 6;
    if (score < 0) continue;
    scored.push({ place, score });
  }

  scored.sort((a, b) => a.score - b.score || a.place.city.localeCompare(b.place.city) || a.place.iata.localeCompare(b.place.iata));
  return scored.slice(0, 8).map((item) => item.place);
}

function bindAirportSuggest(form, onSelect) {
  const inputs = form.querySelectorAll("[data-place-input]");

  inputs.forEach((input) => {
    const field = input.closest(".field");
    const menu = field?.querySelector("[data-place-menu]");
    if (!field || !menu) return;
    let timer = null;

    function closeMenu() {
      menu.hidden = true;
      field.classList.remove("is-suggesting");
    }

    function renderPlaces(places) {
      menu.innerHTML = "";
      if (!places.length) {
        closeMenu();
        return;
      }

      places.forEach((place) => {
        const btn = document.createElement("button");
        btn.type = "button";
        const codeEl = document.createElement("span");
        codeEl.className = "place-code";
        codeEl.textContent = airportLabel(place);
        const cityEl = document.createElement("span");
        cityEl.className = "place-city";
        cityEl.textContent = place.name || place.country || "";
        btn.append(codeEl, cityEl);
        btn.addEventListener("mousedown", (event) => {
          event.preventDefault();
          input.value = airportLabel(place);
          closeMenu();
          onSelect?.();
        });
        menu.appendChild(btn);
      });
      menu.hidden = false;
      field.classList.add("is-suggesting");
    }

    async function search(query) {
      if (query.trim().length < 2) {
        closeMenu();
        return;
      }
      try {
        const airports = await loadAirports();
        if (input.value.trim() !== query) return;
        renderPlaces(matchAirports(airports, query));
      } catch {
        closeMenu();
      }
    }

    input.addEventListener("input", () => {
      const query = input.value.trim();
      clearTimeout(timer);
      onSelect?.();
      if (query.length < 2) {
        closeMenu();
        return;
      }
      timer = setTimeout(() => search(query), 80);
    });

    input.addEventListener("focus", () => {
      if (input.value.trim().length < 2) closeMenu();
    });
  });

  document.addEventListener("click", (event) => {
    form.querySelectorAll("[data-place-menu]").forEach((menu) => {
      const field = menu.closest(".field");
      if (field && !field.contains(event.target)) {
        menu.hidden = true;
        field.classList.remove("is-suggesting");
      }
    });
  });
}

function passengerSummary(adults, under18, under2) {
  const total = adults + under18 + under2;
  if (under18 === 0 && under2 === 0) {
    return adults === 1 ? "1 Adult" : `${adults} Adults`;
  }
  return total === 1 ? "1 Passenger" : `${total} Passengers`;
}

function passengerCounts(data = {}) {
  const adults = Math.max(1, Number(data.adults) || 1);
  const under18 = Math.max(0, Number(data.under18) || 0);
  const under2 = Math.max(0, Number(data.under2) || 0);
  return {
    adults,
    under18,
    under2,
    total: adults + under18 + under2,
    paying: adults + under18,
  };
}

function payingPassengerLabel(adults, under18) {
  const parts = [];
  if (adults > 0) parts.push(adults === 1 ? "1 Adult" : `${adults} Adults`);
  if (under18 > 0) parts.push(under18 === 1 ? "1 Under 18" : `${under18} Under 18`);
  return parts.join(", ") || "1 Adult";
}

function usd(amount) {
  return `$${Number(amount).toFixed(2)}`;
}

function passengerSeatList(data = loadBooking()) {
  const counts = passengerCounts(data);
  const seats = [];
  for (let i = 0; i < counts.adults; i += 1) seats.push({ type: "adult", label: "Adult" });
  for (let i = 0; i < counts.under18; i += 1) seats.push({ type: "under18", label: "Under 18" });
  for (let i = 0; i < counts.under2; i += 1) seats.push({ type: "under2", label: "2 and under" });
  return seats;
}

function readPassengerCounts(form) {
  if (form) {
    return passengerCounts({
      adults: form.querySelector('[name="adults"]')?.value,
      under18: form.querySelector('[name="under18"]')?.value,
      under2: form.querySelector('[name="under2"]')?.value,
    });
  }
  return passengerCounts(loadBooking());
}

function fillSearchFields() {
  const data = loadBooking();
  const from = document.querySelector('[name="from"]');
  const going = document.querySelector('[name="going"]');
  const date = document.querySelector('[name="date"]');
  const returnDate = document.querySelector('[name="returnDate"]');
  const onFlights = document.body.classList.contains("page-flights");
  if (onFlights) {
    if (from && data.from) from.value = data.from;
    if (going && data.going) going.value = data.going;
    if (date && data.date) date.value = data.date;
    if (returnDate && data.returnDate) returnDate.value = data.returnDate;
    const adults = Number(data.adults);
    const under18 = Number(data.under18);
    const under2 = Number(data.under2);
    if (Number.isFinite(adults) || Number.isFinite(under18) || Number.isFinite(under2)) {
      const adultVal = Number.isFinite(adults) && adults > 0 ? adults : 1;
      const u18 = Number.isFinite(under18) ? under18 : 0;
      const u2 = Number.isFinite(under2) ? under2 : 0;
      const adultInput = document.querySelector('[name="adults"]');
      const u18Input = document.querySelector('[name="under18"]');
      const u2Input = document.querySelector('[name="under2"]');
      const label = document.querySelector("[data-passenger-label]");
      if (adultInput) adultInput.value = String(adultVal);
      if (u18Input) u18Input.value = String(u18);
      if (u2Input) u2Input.value = String(u2);
      if (label) label.textContent = passengerSummary(adultVal, u18, u2);
      document.querySelector('[data-passenger-count="adults"]')?.replaceChildren(document.createTextNode(String(adultVal)));
      document.querySelector('[data-passenger-count="under18"]')?.replaceChildren(document.createTextNode(String(u18)));
      document.querySelector('[data-passenger-count="under2"]')?.replaceChildren(document.createTextNode(String(u2)));
    }
  }
}

function bindSearchForm() {
  const form = document.querySelector("[data-search-form]");
  if (!form) return;
  const bar = form.querySelector(".search-bar");
  const flyType = form.querySelector('[name="flyType"]');
  const searchBtn = form.querySelector(".btn-search");
  const requireComplete = form.hasAttribute("data-require-complete");
  const fromInput = form.querySelector('[name="from"]');
  const goingInput = form.querySelector('[name="going"]');
  const dateInput = form.querySelector('[name="date"]');
  const returnInput = form.querySelector('[name="returnDate"]');

  function searchReady() {
    const fromOk = Boolean(fromInput?.value.trim());
    const goingOk = Boolean(goingInput?.value.trim());
    const dateOk = Boolean(dateInput?.value.trim());
    const oneWay = flyType?.value === "One-Way";
    const returnOk = oneWay || Boolean(returnInput?.value.trim());
    return fromOk && goingOk && dateOk && returnOk;
  }

  function syncSearchState() {
    if (!requireComplete || !searchBtn) return;
    searchBtn.disabled = !searchReady();
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (requireComplete && !searchReady()) return;
    searchBtn?.classList.add("is-pressed");
    saveBooking({
      from: form.from.value.trim(),
      going: form.going.value.trim(),
      date: form.date.value.trim(),
      returnDate: form.returnDate?.value.trim() || "",
      flyType: flyType?.value || "Round-Trip",
      adults: Number(form.adults?.value) || 1,
      under18: Number(form.under18?.value) || 0,
      under2: Number(form.under2?.value) || 0,
    });
    sessionStorage.setItem("agodaFromSearch", "1");
    window.location.href = "flights.html";
  });

  const swap = form.querySelector("[data-swap]");

  function placesReady() {
    return Boolean(fromInput?.value.trim() && goingInput?.value.trim());
  }

  function syncSwapState() {
    if (!swap) return;
    swap.classList.toggle("is-ready", placesReady());
  }

  function syncFormState() {
    syncSwapState();
    syncSearchState();
  }

  if (swap && fromInput && goingInput) {
    ["input", "change", "keyup", "paste", "blur"].forEach((eventName) => {
      fromInput.addEventListener(eventName, syncFormState);
      goingInput.addEventListener(eventName, syncFormState);
    });
    swap.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!placesReady()) return;
      const fromValue = fromInput.value;
      fromInput.value = goingInput.value;
      goingInput.value = fromValue;
      swap.classList.add("is-pressed");
      setTimeout(() => swap.classList.remove("is-pressed"), 180);
    });
    syncSwapState();
  }

  ["input", "change"].forEach((eventName) => {
    dateInput?.addEventListener(eventName, syncSearchState);
    returnInput?.addEventListener(eventName, syncSearchState);
  });

  bindAirportSuggest(form, syncFormState);

  const passengerWrap = form.querySelector(".passenger-type");
  const passengerTrigger = form.querySelector("[data-passenger-trigger]");
  const passengerMenu = form.querySelector("[data-passenger-menu]");
  const passengerLabel = form.querySelector("[data-passenger-label]");
  const counts = {
    adults: form.querySelector('[name="adults"]'),
    under18: form.querySelector('[name="under18"]'),
    under2: form.querySelector('[name="under2"]'),
  };

  function closePassengerMenu() {
    if (!passengerMenu) return;
    passengerMenu.hidden = true;
    passengerWrap?.classList.remove("is-open");
  }

  function passengerValue(key) {
    return Number(counts[key]?.value) || 0;
  }

  function renderPassengers() {
    const adults = passengerValue("adults");
    const under18 = passengerValue("under18");
    const under2 = passengerValue("under2");
    form.querySelector('[data-passenger-count="adults"]')?.replaceChildren(document.createTextNode(String(adults)));
    form.querySelector('[data-passenger-count="under18"]')?.replaceChildren(document.createTextNode(String(under18)));
    form.querySelector('[data-passenger-count="under2"]')?.replaceChildren(document.createTextNode(String(under2)));
    if (passengerLabel) passengerLabel.textContent = passengerSummary(adults, under18, under2);
    const adultDec = form.querySelector('[data-passenger-dec="adults"]');
    const adultInc = form.querySelector('[data-passenger-inc="adults"]');
    const u18Dec = form.querySelector('[data-passenger-dec="under18"]');
    const u18Inc = form.querySelector('[data-passenger-inc="under18"]');
    const u2Dec = form.querySelector('[data-passenger-dec="under2"]');
    const u2Inc = form.querySelector('[data-passenger-inc="under2"]');
    if (adultDec) adultDec.disabled = adults <= 1;
    if (adultInc) adultInc.disabled = adults >= 9;
    if (u18Dec) u18Dec.disabled = under18 <= 0;
    if (u18Inc) u18Inc.disabled = under18 >= 9;
    if (u2Dec) u2Dec.disabled = under2 <= 0;
    if (u2Inc) u2Inc.disabled = under2 >= 9;
  }

  function changePassenger(key, delta) {
    const min = key === "adults" ? 1 : 0;
    const next = Math.min(9, Math.max(min, passengerValue(key) + delta));
    if (counts[key]) counts[key].value = String(next);
    renderPassengers();
  }

  if (passengerTrigger && passengerMenu) {
    passengerTrigger.addEventListener("click", (event) => {
      event.stopPropagation();
      closeFlyMenu();
      const calendar = form.querySelector("[data-calendar]");
      if (calendar) calendar.hidden = true;
      const willOpen = passengerMenu.hidden;
      passengerMenu.hidden = !willOpen;
      passengerWrap?.classList.toggle("is-open", willOpen);
    });
    passengerMenu.addEventListener("click", (event) => event.stopPropagation());
    form.querySelectorAll("[data-passenger-inc]").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        changePassenger(btn.dataset.passengerInc, 1);
      });
    });
    form.querySelectorAll("[data-passenger-dec]").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        changePassenger(btn.dataset.passengerDec, -1);
      });
    });
    document.addEventListener("click", closePassengerMenu);
    renderPassengers();
  }

  function syncTripType() {
    const oneWay = flyType?.value === "One-Way";
    bar.classList.toggle("is-one-way", oneWay);
    const returnInput = form.querySelector("[data-return-input]");
    if (returnInput) {
      returnInput.disabled = oneWay;
    }
    if (oneWay) {
      const calendar = form.querySelector("[data-calendar]");
      if (calendar) calendar.hidden = true;
    }
    syncSearchState();
  }

  const trigger = form.querySelector("[data-fly-trigger]");
  const menu = form.querySelector("[data-fly-menu]");
  const label = form.querySelector("[data-fly-label]");
  const flyWrap = form.querySelector(".fly-type");

  function closeFlyMenu() {
    if (!menu) return;
    menu.hidden = true;
    flyWrap?.classList.remove("is-open");
  }

  if (trigger && menu && label) {
    trigger.addEventListener("click", (event) => {
      event.stopPropagation();
      closePassengerMenu();
      const sortMenu = document.querySelector("[data-sort-menu]");
      if (sortMenu) sortMenu.hidden = true;
      document.querySelector(".sort-type")?.classList.remove("is-open");
      const willOpen = menu.hidden;
      menu.hidden = !willOpen;
      flyWrap?.classList.toggle("is-open", willOpen);
    });
    menu.querySelectorAll("[data-value]").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        flyType.value = btn.dataset.value;
        label.textContent = btn.dataset.value;
        closeFlyMenu();
        syncTripType();
      });
    });
    document.addEventListener("click", closeFlyMenu);
  }

  syncTripType();
  bindCalendar(form, syncSearchState);
  syncSearchState();

  searchBtn?.addEventListener("mousedown", () => searchBtn.classList.add("is-pressed"));
  searchBtn?.addEventListener("mouseup", () => searchBtn.classList.remove("is-pressed"));
  searchBtn?.addEventListener("mouseleave", () => searchBtn.classList.remove("is-pressed"));
}

function bindCalendar(form, onChange) {
  const calendar = form.querySelector("[data-calendar]");
  if (!calendar) return;

  const grid = calendar.querySelector("[data-cal-grid]");
  const label = calendar.querySelector("[data-cal-label]");
  const hint = calendar.querySelector("[data-cal-hint]");
  const departInput = form.querySelector("[data-date-input]");
  const returnInput = form.querySelector("[data-return-input]");
  const flyType = form.querySelector('[name="flyType"]');
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let view = parseDate(departInput.value) || new Date(today.getFullYear(), today.getMonth(), 1);
  let picking = "depart";

  function isOneWay() {
    return flyType?.value === "One-Way";
  }

  function selectedDates() {
    return {
      depart: parseDate(departInput.value),
      back: parseDate(returnInput?.value),
    };
  }

  function updateHint() {
    if (isOneWay()) {
      hint.textContent = "Select a departure date";
      return;
    }
    hint.textContent = picking === "return" ? "Select a return date" : "Select a departure date";
  }

  function render() {
    const year = view.getFullYear();
    const month = view.getMonth();
    label.textContent = view.toLocaleString("en-US", { month: "long", year: "numeric" });
    grid.innerHTML = "";

    const first = new Date(year, month, 1);
    const startWeekday = first.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const { depart, back } = selectedDates();

    for (let i = 0; i < startWeekday; i += 1) {
      const empty = document.createElement("span");
      grid.appendChild(empty);
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = new Date(year, month, day);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = String(day);
      btn.disabled = date < today || (picking === "return" && depart && (date < depart || sameDay(date, depart)));
      if (sameDay(date, today)) btn.classList.add("is-today");
      if (sameDay(date, depart) || sameDay(date, back)) btn.classList.add("is-selected");
      if (depart && back && date > depart && date < back) btn.classList.add("is-in-range");
      btn.addEventListener("click", () => chooseDate(date));
      grid.appendChild(btn);
    }

    updateHint();
  }

  function chooseDate(date) {
    if (isOneWay() || picking === "depart") {
      departInput.value = formatDate(date);
      if (isOneWay()) {
        if (returnInput) returnInput.value = "";
        calendar.hidden = true;
      } else {
        const back = parseDate(returnInput.value);
        if (back && (back < date || sameDay(back, date))) returnInput.value = "";
        picking = "return";
      }
    } else {
      const depart = parseDate(departInput.value);
      if (depart && (date < depart || sameDay(date, depart))) return;
      returnInput.value = formatDate(date);
      picking = "depart";
      calendar.hidden = true;
    }
    render();
    onChange?.();
  }

  const dateFields = form.querySelector(".date-fields");
  let ignoreOutside = false;

  function openCalendar(which) {
    if (which === "return" && isOneWay()) return;
    const passengerMenu = form.querySelector("[data-passenger-menu]");
    if (passengerMenu) passengerMenu.hidden = true;
    form.querySelector(".passenger-type")?.classList.remove("is-open");
    picking = which;
    const seed = parseDate(which === "return" ? returnInput?.value : departInput.value);
    view = seed ? new Date(seed.getFullYear(), seed.getMonth(), 1) : new Date(today.getFullYear(), today.getMonth(), 1);
    ignoreOutside = true;
    calendar.hidden = false;
    render();
    setTimeout(() => {
      ignoreOutside = false;
    }, 200);
  }

  departInput.addEventListener("focus", () => openCalendar("depart"));
  returnInput?.addEventListener("focus", () => openCalendar("return"));
  departInput.addEventListener("click", (event) => {
    event.stopPropagation();
    openCalendar("depart");
  });
  returnInput?.addEventListener("click", (event) => {
    event.stopPropagation();
    openCalendar("return");
  });
  departInput.addEventListener("input", () => {
    if (!calendar.hidden) render();
    onChange?.();
  });
  returnInput?.addEventListener("input", () => {
    if (!calendar.hidden) render();
    onChange?.();
  });

  dateFields.addEventListener("click", (event) => event.stopPropagation());

  calendar.querySelector("[data-cal-prev]").addEventListener("click", () => {
    view = new Date(view.getFullYear(), view.getMonth() - 1, 1);
    render();
  });
  calendar.querySelector("[data-cal-next]").addEventListener("click", () => {
    view = new Date(view.getFullYear(), view.getMonth() + 1, 1);
    render();
  });

  flyType?.addEventListener("change", () => {
    if (isOneWay()) picking = "depart";
    if (!calendar.hidden) render();
  });

  document.addEventListener("click", (event) => {
    if (ignoreOutside) return;
    if (!dateFields.contains(event.target)) calendar.hidden = true;
  });
}

function bindFaq() {
  document.querySelectorAll("[data-faq]").forEach((btn) => {
    btn.addEventListener("click", () => btn.classList.toggle("is-open"));
  });
}

function bindTickets() {
  document.querySelectorAll("[data-details]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const ticket = btn.closest(".ticket");
      ticket.classList.toggle("is-open");
    });
  });

  document.querySelectorAll("[data-select]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const ticket = btn.closest(".ticket");
      const times = ticket.querySelectorAll(".time-block strong");
      const codes = ticket.querySelectorAll(".time-block span");
      const durations = ticket.querySelectorAll(".flight-mid p");
      const unitPrice = Number((ticket.querySelector(".price")?.textContent || "").replace(/[^0-9]/g, "")) || 230;
      const unitTax = 25;
      const counts = readPassengerCounts(document.querySelector("[data-search-form]"));
      const fare = unitPrice * counts.paying;
      const taxes = unitTax * counts.paying;
      saveBooking({
        airline: ticket.querySelector(".airline span")?.textContent.trim() || "Delta Airlines",
        departTime: times[0]?.textContent.trim() || "4:45 AM",
        arriveTime: times[1]?.textContent.trim() || "8:15 AM",
        fromCode: codes[0]?.textContent.trim() || "DSM",
        toCode: codes[1]?.textContent.trim() || "JFK",
        duration: durations[0]?.textContent.trim() || "3 hrs 30 min",
        returnDepartTime: times[2]?.textContent.trim() || "5:10 PM",
        returnArriveTime: times[3]?.textContent.trim() || "8:40 PM",
        returnFromCode: codes[2]?.textContent.trim() || "JFK",
        returnToCode: codes[3]?.textContent.trim() || "DSM",
        returnDuration: durations[1]?.textContent.trim() || "3 hrs 30 min",
        adults: counts.adults,
        under18: counts.under18,
        under2: counts.under2,
        unitPrice,
        unitTax,
        price: fare,
        taxes,
        total: fare + taxes,
        destination: "New York (NYC)",
      });
      sessionStorage.setItem("agodaFromSearch", "1");
      window.location.href = "contact.html";
    });
  });
}

function fillTripSummary() {
  if (!document.querySelector(".summary")) return;
  const data = loadBooking();
  const counts = passengerCounts(data);

  const legs = document.querySelectorAll(".leg-times");
  function fillLeg(leg, startTime, endTime, duration, startCode, endCode) {
    if (!leg) return;
    const blocks = [...leg.children];
    const start = blocks[0];
    const mid = blocks[1];
    const end = blocks[2];
    if (start && startTime) start.querySelector("strong").textContent = startTime;
    if (end && endTime) end.querySelector("strong").textContent = endTime;
    if (mid && duration) mid.textContent = duration;
    if (start && startCode) start.querySelector("span").textContent = startCode;
    if (end && endCode) end.querySelector("span").textContent = endCode;
  }
  fillLeg(legs[0], data.departTime, data.arriveTime, data.duration, data.fromCode, data.toCode);
  fillLeg(legs[1], data.returnDepartTime, data.returnArriveTime, data.returnDuration, data.returnFromCode, data.returnToCode);

  document.querySelectorAll(".cabin").forEach((el) => {
    el.textContent = `${counts.total} passenger${counts.total === 1 ? "" : "s"} - Economy`;
  });

  const fareLabel = document.querySelector("[data-fare-label]");
  if (fareLabel) fareLabel.textContent = `Passengers (${payingPassengerLabel(counts.adults, counts.under18)})`;

  const infantRow = document.querySelector("[data-infant-row]");
  if (infantRow) {
    infantRow.hidden = counts.under2 <= 0;
    const infantLabel = infantRow.querySelector("[data-infant-label]");
    if (infantLabel) {
      infantLabel.textContent = counts.under2 === 1 ? "2 and under (1)" : `2 and under (${counts.under2})`;
    }
  }

  const unitPrice = Number(data.unitPrice) > 0 ? Number(data.unitPrice) : Number(data.price) || 0;
  if (!unitPrice) return;

  const unitTax = Number(data.unitTax) > 0 ? Number(data.unitTax) : 25;
  const fare = unitPrice * counts.paying;
  const taxes = unitTax * counts.paying;
  const total = fare + taxes;

  const fareAmount = document.querySelector("[data-fare-amount]");
  const taxAmount = document.querySelector("[data-tax-amount]");
  const totalAmount = document.querySelector("[data-total-amount]");
  if (fareAmount) fareAmount.textContent = usd(fare);
  if (taxAmount) taxAmount.textContent = usd(taxes);
  if (totalAmount) totalAmount.textContent = usd(total);
}

function filledField(el) {
  return Boolean(el && String(el.value || "").trim());
}

function bindCheckoutContinue(form, isReady) {
  const button = form.querySelector(".btn-continue");
  if (!form || !button) return () => {};

  function sync() {
    button.disabled = !isReady();
  }

  form.addEventListener("input", sync);
  form.addEventListener("change", sync);
  sync();
  return sync;
}

function bindContact() {
  const form = document.querySelector("[data-contact-form]");
  if (!form) return;
  saveBooking({ firstName: "", lastName: "", email: "", pFirst: "", pLast: "", phone: "" });
  function clearContactFields() {
    ["firstName", "lastName", "email", "phone"].forEach((name) => {
      if (form[name]) form[name].value = "";
    });
  }
  clearContactFields();
  setTimeout(clearContactFields, 50);
  setTimeout(clearContactFields, 250);
  bindDialCodes(form);
  const syncContinue = bindCheckoutContinue(form, () => {
    const email = form.email.value.trim();
    return (
      filledField(form.firstName) &&
      filledField(form.lastName) &&
      email.includes("@") &&
      filledField(form.phoneCode) &&
      filledField(form.phone)
    );
  });
  setTimeout(syncContinue, 60);
  setTimeout(syncContinue, 280);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (form.querySelector(".btn-continue")?.disabled) return;
    saveBooking({
      firstName: form.firstName.value.trim(),
      lastName: form.lastName.value.trim(),
      email: form.email.value.trim(),
      phoneCode: form.phoneCode.value.trim(),
      phone: form.phone.value.trim(),
    });
    window.location.href = "passenger.html";
  });
}

function flagUrl(code) {
  return `https://flagcdn.com/w40/${String(code || "").toLowerCase()}.png`;
}

async function loadDialCountries() {
  try {
    const response = await fetch("https://countriesnow.space/api/v0.1/countries/codes");
    const json = await response.json();
    const rows = Array.isArray(json.data) ? json.data : [];
    return rows
      .filter((row) => row.dial_code && row.code)
      .map((row) => ({
        name: row.name,
        code: String(row.code).toUpperCase(),
        dial: row.dial_code,
      }))
      .sort((a, b) => {
        if (a.code === "US") return -1;
        if (b.code === "US") return 1;
        return a.name.localeCompare(b.name);
      });
  } catch {
    return [{ name: "United States", code: "US", dial: "+1" }];
  }
}

function bindDialCodes(form) {
  const wrap = form.querySelector("[data-dial-wrap]");
  const box = wrap?.querySelector(".phone-code");
  const menu = form.querySelector("[data-dial-menu]");
  const flag = form.querySelector("[data-dial-flag]");
  const input = form.querySelector("[data-dial-input]");
  if (!wrap || !box || !menu || !flag || !input) return;

  let countries = [];

  function digits(value) {
    return String(value || "").replace(/\D/g, "");
  }

  function closeMenu() {
    menu.hidden = true;
    wrap.classList.remove("is-open");
    input.setAttribute("aria-expanded", "false");
  }

  function openMenu() {
    menu.hidden = false;
    wrap.classList.add("is-open");
    input.setAttribute("aria-expanded", "true");
  }

  function matchCountry(value) {
    const typed = digits(value);
    if (!typed) return countries.find((country) => country.code === "US") || countries[0];
    return (
      countries.find((country) => digits(country.dial) === typed) ||
      countries.find((country) => digits(country.dial).startsWith(typed))
    );
  }

  function applyFlag(country) {
    if (!country) {
      flag.src = "assets/flag-us.svg";
      flag.alt = "";
      return;
    }
    flag.src = country.code === "US" ? "assets/flag-us.svg" : flagUrl(country.code);
    flag.alt = country.name;
  }

  function selectCountry(country) {
    input.value = country.dial;
    applyFlag(country);
    filterMenu(country.dial);
    closeMenu();
  }

  function filterMenu(query) {
    const typed = digits(query);
    [...menu.children].forEach((btn) => {
      const code = digits(btn.dataset.dial);
      btn.hidden = Boolean(typed) && !code.startsWith(typed);
    });
  }

  box.addEventListener("click", () => {
    openMenu();
    input.focus();
  });

  input.addEventListener("focus", () => {
    openMenu();
    filterMenu(input.value);
  });

  input.addEventListener("input", () => {
    let value = input.value.trim();
    if (value && !value.startsWith("+")) value = `+${value.replace(/^\+*/, "")}`;
    input.value = value;
    applyFlag(matchCountry(value));
    filterMenu(value);
    openMenu();
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeMenu();
      return;
    }
    if (event.key === "Enter") {
      const visible = [...menu.children].find((btn) => !btn.hidden);
      if (visible && wrap.classList.contains("is-open")) {
        event.preventDefault();
        const country = countries.find((item) => item.dial === visible.dataset.dial && item.code === visible.dataset.code);
        if (country) selectCountry(country);
      }
    }
  });

  document.addEventListener("click", (event) => {
    if (!wrap.contains(event.target)) closeMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenu();
  });

  loadDialCountries().then((list) => {
    countries = list;
    menu.replaceChildren();
    countries.forEach((country) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("role", "option");
      btn.dataset.dial = country.dial;
      btn.dataset.code = country.code;
      const img = document.createElement("img");
      img.src = country.code === "US" ? "assets/flag-us.svg" : flagUrl(country.code);
      img.width = 22;
      img.height = 15;
      img.alt = "";
      const num = document.createElement("span");
      num.className = "dial-num";
      num.textContent = country.dial;
      btn.append(img, num);
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        selectCountry(country);
      });
      menu.append(btn);
    });
  });
}

function formatDobInput(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 8);
  const month = digits.slice(0, 2);
  const day = digits.slice(2, 4);
  const year = digits.slice(4, 8);
  if (digits.length <= 2) return month;
  if (digits.length <= 4) return `${month}/${day}`;
  return `${month}/${day}/${year}`;
}

function fieldIn(card, field) {
  return card.querySelector(`[data-field="${field}"]`);
}

function cardIsReady(card) {
  const dobDigits = String(fieldIn(card, "dob")?.value || "").replace(/\D/g, "");
  return (
    filledField(fieldIn(card, "first")) &&
    filledField(fieldIn(card, "last")) &&
    dobDigits.length === 8 &&
    filledField(fieldIn(card, "gender"))
  );
}

function bindPassenger() {
  const form = document.querySelector("[data-passenger-form]");
  if (!form) return;
  const template = form.querySelector("[data-passenger-template]");
  const mount = form.querySelector("[data-passenger-cards]");
  if (!template || !mount) return;

  const data = loadBooking();
  const seats = passengerSeatList(data);
  const saved = Array.isArray(data.passengers) ? data.passengers : [];
  mount.replaceChildren();

  seats.forEach((seat, index) => {
    const card = template.content.firstElementChild.cloneNode(true);
    card.dataset.passengerType = seat.type;
    const heading = card.querySelector("[data-passenger-heading]");
    if (heading) heading.textContent = `Passenger ${index + 1} (${seat.label})`;
    card.querySelectorAll("[data-field]").forEach((el) => {
      el.name = `${el.dataset.field}-${index}`;
    });
    card.querySelectorAll("[data-assist]").forEach((el) => {
      el.name = `assist-${index}`;
    });
    const prior = saved[index];
    if (prior && prior.type === seat.type) {
      const dob = fieldIn(card, "dob");
      const gender = fieldIn(card, "gender");
      const nationality = fieldIn(card, "nationality");
      const passport = fieldIn(card, "passport");
      if (dob && prior.dob) dob.value = formatDobInput(prior.dob);
      if (gender && prior.gender) gender.value = prior.gender;
      if (nationality && prior.nationality) nationality.value = prior.nationality;
      if (passport && prior.passport) passport.value = prior.passport;
      if (Array.isArray(prior.assist)) {
        card.querySelectorAll("[data-assist]").forEach((el) => {
          el.checked = prior.assist.includes(el.value);
        });
      }
    }
    mount.append(card);
  });

  form.querySelectorAll('[data-field="dob"]').forEach((dob) => {
    dob.value = formatDobInput(dob.value);
    dob.addEventListener("input", () => {
      dob.value = formatDobInput(dob.value);
    });
  });

  function cards() {
    return [...mount.querySelectorAll("[data-passenger-card]")];
  }

  function clearPassengerNames() {
    cards().forEach((card) => {
      const first = fieldIn(card, "first");
      const last = fieldIn(card, "last");
      if (first) first.value = "";
      if (last) last.value = "";
    });
  }
  clearPassengerNames();
  setTimeout(clearPassengerNames, 50);
  setTimeout(clearPassengerNames, 250);
  const syncContinue = bindCheckoutContinue(form, () => cards().every(cardIsReady));
  setTimeout(syncContinue, 60);
  setTimeout(syncContinue, 280);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (form.querySelector(".btn-continue")?.disabled) return;
    const passengers = cards().map((card, index) => {
      const seat = seats[index];
      return {
        type: seat.type,
        label: seat.label,
        first: fieldIn(card, "first")?.value.trim() || "",
        last: fieldIn(card, "last")?.value.trim() || "",
        dob: fieldIn(card, "dob")?.value || "",
        gender: fieldIn(card, "gender")?.value.trim() || "",
        nationality: fieldIn(card, "nationality")?.value.trim() || "",
        passport: fieldIn(card, "passport")?.value.trim() || "",
        assist: [...card.querySelectorAll("[data-assist]:checked")].map((el) => el.value),
      };
    });
    const first = passengers[0] || {};
    saveBooking({
      passengers,
      pFirst: first.first || "",
      pLast: first.last || "",
      dob: first.dob || "",
      gender: first.gender || "",
      nationality: first.nationality || "",
      passport: first.passport || "",
      assist: first.assist || [],
    });
    window.location.href = "payment.html";
  });
}

function formatExpInput(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 6);
  const month = digits.slice(0, 2);
  const year = digits.slice(2, 6);
  if (digits.length <= 2) return month;
  return `${month}/${year}`;
}

function bindPayment() {
  const form = document.querySelector("[data-payment-form]");
  if (!form) return;

  const exp = form.exp;
  if (exp) {
    exp.value = formatExpInput(exp.value);
    exp.addEventListener("input", () => {
      exp.value = formatExpInput(exp.value);
    });
  }

  const options = form.querySelectorAll(".pay-option");
  const syncContinue = bindCheckoutContinue(form, () => {
    const method = form.querySelector('input[name="method"]:checked')?.value;
    if (method === "card") {
      const expDigits = String(form.exp?.value || "").replace(/\D/g, "");
      return (
        filledField(form.cardNumber) &&
        filledField(form.cardName) &&
        expDigits.length === 6 &&
        filledField(form.cvv)
      );
    }
    return method === "paypal" || method === "monthly";
  });
  options.forEach((option) => {
    option.querySelector(".pay-head").addEventListener("click", () => {
      options.forEach((el) => el.classList.remove("is-selected"));
      option.classList.add("is-selected");
      option.querySelector('input[type="radio"]').checked = true;
      syncContinue();
    });
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (form.querySelector(".btn-continue")?.disabled) return;
    saveBooking({ booked: true });
    sessionStorage.removeItem("agodaFromSearch");
    window.location.href = "index.html";
  });
}

function bindSortMenu() {
  const wrap = document.querySelector(".sort-type");
  const trigger = document.querySelector("[data-sort-trigger]");
  const menu = document.querySelector("[data-sort-menu]");
  const label = document.querySelector("[data-sort-label]");
  const list = document.querySelector(".tickets");
  if (!wrap || !trigger || !menu || !label) return;

  const tickets = [...document.querySelectorAll(".ticket")];
  tickets.forEach((ticket, index) => {
    ticket.dataset.matchRank = String(index);
  });

  function applySort(mode) {
    if (!list) return;
    const more = list.querySelector(".tickets-more");
    const items = [...list.querySelectorAll(".ticket")];
    items.sort((a, b) => {
      if (mode === "Cheapest") {
        return Number(a.dataset.price) - Number(b.dataset.price);
      }
      if (mode === "Fastest") {
        const duration = Number(a.dataset.duration) - Number(b.dataset.duration);
        if (duration) return duration;
        return Number(a.dataset.price) - Number(b.dataset.price);
      }
      return Number(a.dataset.matchRank) - Number(b.dataset.matchRank);
    });
    items.forEach((ticket) => list.insertBefore(ticket, more));
  }

  let ignoreOutside = false;

  function closeSortMenu() {
    menu.hidden = true;
    wrap.classList.remove("is-open");
  }

  function closeFlyMenu() {
    const flyMenu = document.querySelector("[data-fly-menu]");
    const flyWrap = document.querySelector(".fly-type");
    if (flyMenu) flyMenu.hidden = true;
    flyWrap?.classList.remove("is-open");
  }

  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    closeFlyMenu();
    const willOpen = menu.hidden;
    ignoreOutside = true;
    menu.hidden = !willOpen;
    wrap.classList.toggle("is-open", willOpen);
    setTimeout(() => {
      ignoreOutside = false;
    }, 200);
  });

  menu.querySelectorAll("[data-value]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      label.textContent = btn.dataset.value;
      applySort(btn.dataset.value);
      closeSortMenu();
    });
  });

  wrap.addEventListener("click", (event) => event.stopPropagation());

  document.addEventListener("click", (event) => {
    if (ignoreOutside) return;
    if (!wrap.contains(event.target)) closeSortMenu();
  });
}

function bindFilterPanel() {
  const openBtn = document.querySelector("[data-filter-open]");
  const panel = document.querySelector("#filter-panel");
  const backdrop = document.querySelector("[data-filter-backdrop]");
  const closeBtn = document.querySelector("[data-filter-close]");
  const clearBtn = document.querySelector("[data-filter-clear]");
  const minInput = panel?.querySelector("[data-price-min]");
  const maxInput = panel?.querySelector("[data-price-max]");
  const fill = panel?.querySelector("[data-range-fill]");
  const empty = document.querySelector("[data-filter-empty]");
  const more = document.querySelector(".tickets-more");
  if (!openBtn || !panel || !backdrop) return;

  const defaults = {
    stops: ["0"],
    duration: ["any"],
    minPrice: "100",
    maxPrice: "1000",
  };

  function hourBucket(hour) {
    const h = Number(hour);
    if (h >= 5 && h < 12) return "morning";
    if (h >= 12 && h < 18) return "afternoon";
    if (h >= 18 || h < 5) return "evening";
    return "";
  }

  function durationBucket(minutes) {
    const m = Number(minutes);
    if (m <= 120) return "0-2";
    if (m <= 360) return "2-6";
    return "6+";
  }

  function checkedValues(name) {
    return [...panel.querySelectorAll(`input[name="${name}"]:checked`)].map((el) => el.value);
  }

  function updateRangeFill() {
    if (!minInput || !maxInput || !fill) return;
    let min = Number(minInput.value);
    let max = Number(maxInput.value);
    if (min > max) {
      const active = document.activeElement === maxInput ? maxInput : minInput;
      if (active === minInput) maxInput.value = String(min);
      else minInput.value = String(max);
      min = Number(minInput.value);
      max = Number(maxInput.value);
    }
    const lo = Number(minInput.min);
    const hi = Number(minInput.max);
    const span = hi - lo || 1;
    fill.style.left = `${((min - lo) / span) * 100}%`;
    fill.style.width = `${((max - min) / span) * 100}%`;
  }

  function applyFilters() {
    const stops = checkedValues("stops");
    const airlines = checkedValues("airline");
    const depart = checkedValues("depart");
    const arrive = checkedValues("arrive");
    const duration = checkedValues("duration");
    const minPrice = Number(minInput?.value || 100);
    const maxPrice = Number(maxInput?.value || 1000);
    const tickets = [...document.querySelectorAll(".ticket")];
    let shown = 0;

    tickets.forEach((ticket) => {
      const price = Number(ticket.dataset.price);
      const stopKey = String(ticket.dataset.stops);
      const airline = ticket.dataset.airline;
      let visible = true;

      if (price < minPrice || price > maxPrice) visible = false;
      if (stops.length && !stops.includes(stopKey === "0" ? "0" : stopKey === "1" ? "1" : "2")) visible = false;
      if (airlines.length && !airlines.includes(airline)) visible = false;
      if (depart.length && !depart.includes(hourBucket(ticket.dataset.departHour))) visible = false;
      if (arrive.length && !arrive.includes(hourBucket(ticket.dataset.arriveHour))) visible = false;
      if (duration.length && !duration.includes("any") && !duration.includes(durationBucket(ticket.dataset.duration))) {
        visible = false;
      }

      ticket.classList.toggle("is-filtered-out", !visible);
      if (visible) shown += 1;
    });

    if (empty) empty.hidden = shown !== 0;
    if (more) more.hidden = shown === 0;
  }

  function openPanel() {
    panel.hidden = false;
    backdrop.hidden = false;
    openBtn.setAttribute("aria-expanded", "true");
    openBtn.classList.add("is-open");
  }

  function closePanel() {
    panel.hidden = true;
    backdrop.hidden = true;
    openBtn.setAttribute("aria-expanded", "false");
    openBtn.classList.remove("is-open");
  }

  function resetFilters() {
    panel.querySelectorAll("input[type='checkbox']").forEach((input) => {
      if (input.name === "stops") input.checked = defaults.stops.includes(input.value);
      else if (input.name === "duration") input.checked = defaults.duration.includes(input.value);
      else input.checked = false;
    });
    if (minInput) minInput.value = defaults.minPrice;
    if (maxInput) maxInput.value = defaults.maxPrice;
    updateRangeFill();
    applyFilters();
  }

  openBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    if (panel.hidden) openPanel();
    else closePanel();
  });

  closeBtn?.addEventListener("click", closePanel);
  backdrop.addEventListener("click", closePanel);
  clearBtn?.addEventListener("click", resetFilters);

  panel.querySelectorAll("[data-filter-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      btn.closest(".filter-section")?.classList.toggle("is-collapsed");
    });
  });

  panel.querySelectorAll("input[name='duration']").forEach((input) => {
    input.addEventListener("change", () => {
      if (input.value === "any" && input.checked) {
        panel.querySelectorAll("input[name='duration']").forEach((el) => {
          if (el !== input) el.checked = false;
        });
      } else if (input.value !== "any" && input.checked) {
        const any = panel.querySelector("input[name='duration'][value='any']");
        if (any) any.checked = false;
      }
    });
  });

  panel.addEventListener("change", applyFilters);
  minInput?.addEventListener("input", () => {
    updateRangeFill();
    applyFilters();
  });
  maxInput?.addEventListener("input", () => {
    updateRangeFill();
    applyFilters();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden) closePanel();
  });

  updateRangeFill();
  applyFilters();
}

document.addEventListener("DOMContentLoaded", () => {
  fillSearchFields();
  fillTripSummary();
  bindSearchForm();
  bindFaq();
  bindTickets();
  bindContact();
  bindPassenger();
  bindPayment();
  bindSortMenu();
  bindFilterPanel();
});
