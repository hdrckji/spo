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

  function closeMenu() {
    navLinks.classList.remove("is-open");
    burger.classList.remove("is-open");
    burger.setAttribute("aria-expanded", "false");
    document.body.style.overflow = "";
  }

  burger.addEventListener("click", () => {
    const open = navLinks.classList.toggle("is-open");
    burger.classList.toggle("is-open", open);
    burger.setAttribute("aria-expanded", String(open));
    document.body.style.overflow = open ? "hidden" : "";
  });
  navLinks.querySelectorAll("a").forEach((a) => a.addEventListener("click", closeMenu));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && navLinks.classList.contains("is-open")) {
      closeMenu();
      burger.focus();
    }
  });

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

     Les créneaux, les tarifs et les disponibilités viennent tous de
     /api/availability. Le navigateur n'en détient plus aucune copie :
     il ne peut donc ni proposer un créneau déjà pris, ni se tromper de
     tarif, ni dériver du serveur.
     ============================================================ */

  const typeChoice = document.getElementById("type-choice");
  const datePills = document.getElementById("date-pills");
  const slotGrid = document.getElementById("slot-grid");
  const slotHint = document.getElementById("slot-hint");
  const sumType = document.getElementById("sum-type");
  const sumDate = document.getElementById("sum-date");
  const sumSlot = document.getElementById("sum-slot");
  const form = document.getElementById("booking-form");
  const formError = document.getElementById("form-error");
  const submitBtn = document.getElementById("submit-btn");
  const successPanel = document.getElementById("booking-success");
  const successRecap = document.getElementById("success-recap");
  const successNote = document.getElementById("success-note");

  const CONTACT = "contact@instants-reflexo.be";

  /** Réponse de /api/availability. */
  let data = null;
  const state = { type: "classique", date: null, slot: null };

  const dayByDate = (date) => data?.days.find((d) => d.date === date) ?? null;
  const slotDef = (id) => data?.slots.find((s) => s.id === id) ?? null;
  const typeDef = (id) => data?.types.find((t) => t.id === id) ?? null;

  /** Un créneau est réservable si le serveur le dit et s'il accepte ce type. */
  function isBookable(date, slotId, type) {
    const day = dayByDate(date);
    if (!day) return false;
    const slot = day.slots.find((s) => s.id === slotId);
    if (!slot?.available) return false;
    if (type === "personnalisee" && !slotDef(slotId)?.perso) return false;
    return true;
  }

  /** Cette journée propose-t-elle encore quelque chose pour ce type de séance ? */
  function dayOpen(day, type) {
    return day.available && day.slots.some((s) => isBookable(day.date, s.id, type));
  }

  /* ---------- Chargement ---------- */
  async function loadAvailability() {
    const res = await fetch("/api/availability", { headers: { Accept: "application/json" } });
    const payload = await res.json().catch(() => null);
    if (!res.ok || !payload?.ok) {
      throw new Error(payload?.error || `HTTP ${res.status}`);
    }
    data = payload;

    // Une date ou un créneau devenus indisponibles entre-temps sont oubliés.
    if (state.date && !dayByDate(state.date)) state.date = null;
    if (state.date && !dayOpen(dayByDate(state.date), state.type)) state.date = null;
    if (state.slot && (!state.date || !isBookable(state.date, state.slot, state.type))) {
      state.slot = null;
    }
    if (!state.date) {
      state.date = data.days.find((d) => dayOpen(d, state.type))?.date ?? null;
    }
  }

  function showUnavailable(message) {
    datePills.innerHTML = "";
    slotGrid.innerHTML = "";
    const p = document.createElement("p");
    p.className = "booking__offline";
    p.setAttribute("role", "status");
    p.append(message + " ");
    const link = document.createElement("a");
    link.href = "mailto:" + CONTACT;
    link.textContent = "Écrivez-nous à " + CONTACT;
    p.appendChild(link);
    p.append(", nous fixerons votre rendez-vous ensemble.");
    datePills.appendChild(p);
    submitBtn.disabled = true;
    slotHint.hidden = true;
  }

  /* ---------- Rendus ---------- */
  function renderTypes() {
    typeChoice.querySelectorAll(".type-card").forEach((card) => {
      const def = typeDef(card.dataset.type);
      const active = card.dataset.type === state.type;
      card.classList.toggle("is-active", active);
      card.setAttribute("aria-pressed", String(active));
      if (def) {
        const price = card.querySelector(".type-card__price");
        const desc = card.querySelector(".type-card__desc");
        if (price) price.textContent = `${def.price} €`;
        if (desc) desc.textContent = def.desc;
      }
    });
  }

  function renderDates() {
    datePills.innerHTML = "";
    data.days.forEach((day) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "date-pill";
      btn.textContent = day.shortLabel;
      btn.dataset.date = day.date;

      const open = dayOpen(day, state.type);
      btn.disabled = !open;
      if (!open) {
        btn.title = day.blocked
          ? "Patricia n'est pas disponible ce jour-là"
          : "Plus de créneau libre pour cette séance";
      }

      const active = state.date === day.date;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", String(active));

      btn.addEventListener("click", () => {
        state.date = day.date;
        if (state.slot && !isBookable(day.date, state.slot, state.type)) state.slot = null;
        render();
      });
      datePills.appendChild(btn);
    });
  }

  function renderSlots() {
    slotGrid.innerHTML = "";
    const day = dayByDate(state.date);

    data.slots.forEach((slot) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "slot-btn";
      btn.append(slot.label);
      if (slot.perso) {
        const star = document.createElement("span");
        star.className = "star";
        star.setAttribute("aria-hidden", "true");
        star.textContent = " ✦";
        btn.appendChild(star);
      }

      const bookable = day ? isBookable(day.date, slot.id, state.type) : false;
      btn.disabled = !bookable;

      if (!day) {
        btn.title = "Choisissez d'abord un vendredi";
      } else if (!bookable) {
        const info = day.slots.find((s) => s.id === slot.id);
        if (state.type === "personnalisee" && !slot.perso) {
          btn.title = "La séance personnalisée n'est proposée qu'à 10h30 et 16h00";
        } else if (info?.reason === "taken") {
          btn.title = "Déjà réservé";
        } else if (info?.reason === "too-soon") {
          btn.title = `Trop proche — réservation ${data.minNoticeHours} h à l'avance minimum`;
        } else {
          btn.title = "Indisponible";
        }
      }

      const active = state.slot === slot.id && bookable;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", String(active));

      btn.addEventListener("click", () => {
        state.slot = slot.id;
        render();
      });
      slotGrid.appendChild(btn);
    });
  }

  function updateSummary() {
    const t = typeDef(state.type);
    sumType.textContent = t ? `${t.label} — ${t.price} €` : "—";
    sumDate.textContent = dayByDate(state.date)?.label ?? "—";
    sumSlot.textContent = slotDef(state.slot)?.label ?? "—";
  }

  function render() {
    renderTypes();
    renderDates();
    renderSlots();
    updateSummary();
  }

  function setType(type) {
    if (!typeDef(type)) return;
    state.type = type;
    if (state.date && state.slot && !isBookable(state.date, state.slot, type)) state.slot = null;
    // Le vendredi choisi peut ne plus rien proposer pour ce type de séance.
    if (!state.date || !dayOpen(dayByDate(state.date), type)) {
      state.date = data.days.find((d) => dayOpen(d, type))?.date ?? null;
      state.slot = null;
    }
    render();
  }

  typeChoice.querySelectorAll(".type-card").forEach((card) =>
    card.addEventListener("click", () => {
      if (data) setType(card.dataset.type);
    })
  );

  /* Les boutons « Réserver » des cartes tarifs présélectionnent le type. */
  document.querySelectorAll("[data-select-type]").forEach((a) =>
    a.addEventListener("click", () => {
      if (data) setType(a.dataset.selectType);
    })
  );

  /* ---------- Envoi ---------- */
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    formError.hidden = true;

    if (!data) {
      showError(`Le module de réservation n'a pas pu se charger. Écrivez-nous à ${CONTACT}.`);
      return;
    }

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

    submitBtn.disabled = true;
    submitBtn.textContent = "Envoi en cours…";

    try {
      const res = await fetch("/api/reserve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: state.type,
          date: state.date,
          slot: state.slot,
          name,
          email,
          phone,
          message,
          website: honeypot,
        }),
      });
      const payload = await res.json().catch(() => null);

      if (res.status === 409) {
        // Quelqu'un a pris le créneau entre l'affichage et l'envoi : on
        // recharge les disponibilités pour montrer l'état réel de l'agenda.
        await loadAvailability().catch(() => {});
        if (data) render();
        showError(payload?.error || "Ce créneau vient d'être réservé. Merci d'en choisir un autre.");
        return;
      }
      if (!res.ok || !payload?.ok) {
        showError(payload?.error || `Un souci technique empêche l'envoi. Écrivez-nous à ${CONTACT}.`);
        return;
      }

      showSuccess(payload);
    } catch (err) {
      showError(`Un souci technique empêche l'envoi. Écrivez-nous à ${CONTACT}.`);
    } finally {
      if (successPanel.hidden) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Confirmer ma réservation";
      }
    }
  });

  function showError(msg) {
    formError.textContent = msg;
    formError.hidden = false;
  }

  function showSuccess(payload) {
    const b = payload.booking;
    successRecap.textContent =
      `${b.name}, votre séance ${b.type.toLowerCase()} du ${b.dateLabel} (${b.slot}) est confirmée. ` +
      `Le paiement de ${b.price} € se fait sur place.`;

    // Si l'e-mail n'est pas parti, on le dit. La réservation, elle, est bien
    // enregistrée : c'est la base qui fait foi, pas la messagerie.
    successNote.textContent = payload.emailed
      ? "Un e-mail de confirmation vient de vous être envoyé, avec le rendez-vous à ajouter à votre agenda. À très bientôt."
      : `Votre rendez-vous est bien enregistré, mais l'e-mail de confirmation n'a pas pu partir. Merci de nous écrire à ${CONTACT} pour que nous vous confirmions tout ça.`;
    successNote.classList.toggle("is-warning", !payload.emailed);

    successPanel.hidden = false;
    successPanel.focus();
    successPanel.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  /* ---------- Init ---------- */
  loadAvailability()
    .then(() => {
      if (!data.days.some((d) => d.available)) {
        showUnavailable("Aucun créneau n'est libre dans les prochaines semaines.");
        return;
      }
      render();
    })
    .catch((err) => {
      console.error("[réservation] disponibilités indisponibles :", err);
      showUnavailable("La réservation en ligne est momentanément indisponible.");
    });
})();
