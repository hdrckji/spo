/* ============================================================
   Instants Réflexo — interactions & réservation
   ============================================================ */

(function () {
  "use strict";

  /* ---------- Navigation ---------- */
  const nav = document.getElementById("nav");
  const burger = document.getElementById("nav-burger");
  const navLinks = document.getElementById("nav-links");

  const onScroll = () => nav.classList.toggle("is-scrolled", window.scrollY > 40);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  burger.addEventListener("click", () => {
    const open = navLinks.classList.toggle("is-open");
    burger.classList.toggle("is-open", open);
    burger.setAttribute("aria-expanded", String(open));
    document.body.style.overflow = open ? "hidden" : "";
  });
  navLinks.querySelectorAll("a").forEach((a) =>
    a.addEventListener("click", () => {
      navLinks.classList.remove("is-open");
      burger.classList.remove("is-open");
      document.body.style.overflow = "";
    })
  );

  /* ---------- Apparition au scroll ---------- */
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("is-visible");
          io.unobserve(e.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
  );
  document.querySelectorAll(".reveal").forEach((el) => io.observe(el));

  /* ---------- Année du footer ---------- */
  document.getElementById("year").textContent = new Date().getFullYear();

  /* ============================================================
     Réservation
     ============================================================ */
  const SLOTS = [
    { id: "09:30", label: "9h30 – 10h30", perso: false },
    { id: "10:30", label: "10h30 – 11h30", perso: true },
    { id: "14:00", label: "14h00 – 15h00", perso: false },
    { id: "15:00", label: "15h00 – 16h00", perso: false },
    { id: "16:00", label: "16h00 – 17h00", perso: true },
  ];

  const TYPES = {
    classique: { label: "Classique", price: 65 },
    personnalisee: { label: "Personnalisée", price: 85 },
  };

  const state = { type: "classique", date: null, slot: null };

  const typeChoice = document.getElementById("type-choice");
  const datePills = document.getElementById("date-pills");
  const slotGrid = document.getElementById("slot-grid");
  const sumType = document.getElementById("sum-type");
  const sumDate = document.getElementById("sum-date");
  const sumSlot = document.getElementById("sum-slot");
  const form = document.getElementById("booking-form");
  const formError = document.getElementById("form-error");
  const submitBtn = document.getElementById("submit-btn");
  const successPanel = document.getElementById("booking-success");
  const successRecap = document.getElementById("success-recap");

  const fmtLong = new Intl.DateTimeFormat("fr-BE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const fmtShort = new Intl.DateTimeFormat("fr-BE", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

  /* Les 8 prochains vendredis */
  function nextFridays(count) {
    const out = [];
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    // vendredi = 5 ; si on est vendredi, on propose à partir du suivant
    const delta = ((5 - d.getDay() + 7) % 7) || 7;
    d.setDate(d.getDate() + delta);
    for (let i = 0; i < count; i++) {
      out.push(new Date(d));
      d.setDate(d.getDate() + 7);
    }
    return out;
  }

  const fridays = nextFridays(8);

  function isoDate(d) {
    return d.toISOString().slice(0, 10);
  }

  /* ---------- Rendus ---------- */
  function renderDates() {
    datePills.innerHTML = "";
    fridays.forEach((d) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "date-pill";
      btn.textContent = fmtShort.format(d);
      btn.dataset.date = isoDate(d);
      if (state.date === isoDate(d)) btn.classList.add("is-active");
      btn.addEventListener("click", () => {
        state.date = isoDate(d);
        renderDates();
        updateSummary();
      });
      datePills.appendChild(btn);
    });
  }

  function renderSlots() {
    slotGrid.innerHTML = "";
    SLOTS.forEach((s) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "slot-btn";
      btn.innerHTML = s.label + (s.perso ? ' <span class="star">✦</span>' : "");
      btn.disabled = state.type === "personnalisee" && !s.perso;
      if (state.slot === s.id && !btn.disabled) btn.classList.add("is-active");
      btn.addEventListener("click", () => {
        state.slot = s.id;
        renderSlots();
        updateSummary();
      });
      slotGrid.appendChild(btn);
    });
  }

  function updateSummary() {
    const t = TYPES[state.type];
    sumType.textContent = `${t.label} — ${t.price} €`;
    sumDate.textContent = state.date
      ? fmtLong.format(new Date(state.date + "T00:00:00"))
      : "—";
    const slot = SLOTS.find((s) => s.id === state.slot);
    sumSlot.textContent = slot ? slot.label : "—";
  }

  function setType(type) {
    state.type = type;
    // un créneau incompatible est réinitialisé
    const slot = SLOTS.find((s) => s.id === state.slot);
    if (type === "personnalisee" && slot && !slot.perso) state.slot = null;
    typeChoice.querySelectorAll(".type-card").forEach((c) =>
      c.classList.toggle("is-active", c.dataset.type === type)
    );
    renderSlots();
    updateSummary();
  }

  typeChoice.querySelectorAll(".type-card").forEach((card) =>
    card.addEventListener("click", () => setType(card.dataset.type))
  );

  /* Boutons "Réserver" des cartes tarifs pré-sélectionnent le type */
  document.querySelectorAll("[data-select-type]").forEach((a) =>
    a.addEventListener("click", () => setType(a.dataset.selectType))
  );

  /* ---------- Envoi ---------- */
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    formError.hidden = true;

    const name = document.getElementById("f-name").value.trim();
    const email = document.getElementById("f-email").value.trim();
    const phone = document.getElementById("f-phone").value.trim();
    const message = document.getElementById("f-message").value.trim();
    const honeypot = document.getElementById("f-website").value;

    if (!state.date || !state.slot) {
      showError("Merci de choisir un vendredi et un créneau horaire.");
      return;
    }
    if (!name || !email) {
      showError("Merci d'indiquer votre nom et votre adresse e-mail.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showError("L'adresse e-mail semble invalide.");
      return;
    }

    const t = TYPES[state.type];
    const slot = SLOTS.find((s) => s.id === state.slot);
    const payload = {
      type: t.label,
      price: t.price,
      date: state.date,
      dateLabel: fmtLong.format(new Date(state.date + "T00:00:00")),
      slot: slot.label,
      name,
      email,
      phone,
      message,
      website: honeypot,
    };

    submitBtn.disabled = true;
    submitBtn.textContent = "Envoi en cours…";

    try {
      const res = await fetch("/api/reserve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      showSuccess(payload);
    } catch (err) {
      showError(
        "Un souci technique empêche l'envoi. Vous pouvez nous écrire directement à contact@instants-reflexo.be."
      );
      submitBtn.disabled = false;
      submitBtn.textContent = "Confirmer ma demande";
    }
  });

  function showError(msg) {
    formError.textContent = msg;
    formError.hidden = false;
  }

  function showSuccess(p) {
    successRecap.textContent = `${p.name}, votre demande de séance ${p.type.toLowerCase()} du ${p.dateLabel} (${p.slot}) a bien été transmise à Patricia.`;
    successPanel.hidden = false;
    successPanel.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  /* ---------- Init ---------- */
  renderDates();
  renderSlots();
  updateSummary();
})();
