(() => {
  "use strict";

  const cfg = window.FAMILYCHAT_CONFIG || {};
  const $ = id => document.getElementById(id);

  let sb = null;
  let user = null;
  let active = null;
  let channel = null;
  let conversations = [];
  let contacts = [];
  let busy = false;
  let entering = false;
  let refreshTimer = null;
  let deleteChatBtn = null;

  // =========================================
  // UTILIDADES
  // =========================================

  function status(message, target = "appStatus", bad = false) {
    const element = $(target);
    if (!element) return;

    element.textContent = message;
    element.style.color = bad ? "#e04444" : "var(--purple)";
  }

  function showLogin() {
    $("loginView").classList.remove("hidden");
    $("appView").classList.add("hidden");
  }

  function showApp() {
    $("loginView").classList.add("hidden");
    $("appView").classList.remove("hidden");
  }

  function getPersonId(person) {
    return person.id ||
      person.user_id ||
      person.contact_id ||
      person.requester_id ||
      null;
  }

  function getPersonName(person) {
    return person.display_name ||
      person.username ||
      person.name ||
      "Usuario";
  }

  async function getAuthenticatedUser() {
    const { data, error } = await sb.auth.getUser();

    if (error) throw error;
    if (!data.user) throw new Error("Debes iniciar sesión.");

    return data.user;
  }

  // =========================================
  // PERFIL E INICIO DE SESIÓN
  // =========================================

  async function enter(authUser) {
    if (entering) return;

    entering = true;

    try {
      const authenticatedUser = await getAuthenticatedUser();

      if (authenticatedUser.id !== authUser.id) {
        throw new Error("La sesión cambió. Vuelve a iniciar sesión.");
      }

      user = authenticatedUser;

      const { data: profile, error } = await sb
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .maybeSingle();

      if (error) throw error;

      if (!profile) {
        throw new Error("No encontramos tu perfil.");
      }

      if (!profile.invite_accepted) {
        showLogin();
        status("Necesitas una invitación válida.", "loginStatus", true);
        return;
      }

      $("profileName").textContent =
        profile.display_name ||
        user.user_metadata?.full_name ||
        "Usuario";

      $("profileEmail").textContent = user.email || "";

      $("avatar").src =
        profile.avatar_url ||
        user.user_metadata?.avatar_url ||
        "icon.svg";

      showApp();

      await Promise.all([
        loadConversations(),
        loadContacts(),
        loadRequests()
      ]);

      status("FamilyChat está conectado.");

      startRefresh();

    } finally {
      entering = false;
    }
  }

  // =========================================
  // TARJETAS DE USUARIOS
  // =========================================

  function addPersonCard(
    container,
    person,
    buttonText,
    onAction,
    detailText = ""
  ) {
    const card = document.createElement("div");
    card.className = "contact-item";

    let avatar;

    if (person.avatar_url) {
      avatar = document.createElement("img");
      avatar.src = person.avatar_url;
      avatar.alt = "";
      avatar.className = "contact-avatar";
    } else {
      avatar = document.createElement("div");
      avatar.className = "contact-avatar";
      avatar.textContent = "👤";
    }

    const info = document.createElement("div");
    info.style.flex = "1";
    info.style.minWidth = "0";

    const name = document.createElement("strong");
    name.textContent = getPersonName(person);

    const detail = document.createElement("small");
    detail.textContent = detailText || person.email || "";

    info.append(name, detail);
    card.append(avatar, info);

    if (buttonText && onAction) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = buttonText;
      button.addEventListener("click", onAction);
      card.append(button);
    }

    container.append(card);
    return card;
  }

  // =========================================
  // BUSCAR USUARIOS
  // =========================================

  async function searchUsers() {
    const term = $("userSearchInput").value.trim();
    const results = $("userSearchResults");

    results.innerHTML = "";
    $("searchUsersBtn").disabled = true;

    status("Buscando usuarios...");

    try {
      const { data, error } = await sb.rpc(
        "search_familychat_users",
        { p_search: term }
      );

      if (error) throw error;

      const contactIds = new Set(
        contacts.map(person => getPersonId(person))
      );

      const users = (data || []).filter(person => {
        const id = getPersonId(person);
        return id && !contactIds.has(id) && id !== user.id;
      });

      if (!users.length) {
        results.textContent = term
          ? "No hay usuarios nuevos para mostrar."
          : "No hay otros usuarios disponibles.";

        status("");
        return;
      }

      users.forEach(person => {
        const id = getPersonId(person);

        addPersonCard(
          results,
          person,
          "Agregar",
          () => sendFriendRequest(id),
          "Usuario de FamilyChat"
        );
      });

      status(`Se encontraron ${users.length} usuario(s) nuevos.`);

    } catch (error) {
      console.error("ERROR BUSCANDO USUARIOS:", error);

      status(
        "Error al buscar: " + error.message,
        "appStatus",
        true
      );

    } finally {
      $("searchUsersBtn").disabled = false;
    }
  }

  // =========================================
  // SOLICITUDES DE CONTACTO
  // =========================================

  async function sendFriendRequest(recipientId) {
    try {
      const { error } = await sb.rpc(
        "send_friend_request",
        { p_recipient_id: recipientId }
      );

      if (error) throw error;

      status("¡Solicitud enviada!");

      await Promise.all([
        loadContacts(),
        loadRequests()
      ]);

    } catch (error) {
      console.error("ERROR ENVIANDO SOLICITUD:", error);

      status(
        "No se pudo enviar la solicitud: " + error.message,
        "appStatus",
        true
      );
    }
  }

  async function loadRequests() {
    const list = $("friendRequestsList");
    list.innerHTML = "";

    const { data, error } = await sb.rpc("list_friend_requests");

    if (error) {
      console.error("ERROR CARGANDO SOLICITUDES:", error);
      list.textContent = "No se pudieron cargar las solicitudes.";
      return;
    }

    const requests = data || [];

    $("requestCount").textContent =
      requests.length ? `(${requests.length})` : "";

    if (!requests.length) {
      list.textContent = "No tienes solicitudes pendientes.";
      return;
    }

    requests.forEach(request => {
      const id = request.request_id || request.id;

      const card = addPersonCard(
        list,
        request,
        "Aceptar",
        () => respondRequest(id, true)
      );

      const reject = document.createElement("button");
      reject.type = "button";
      reject.textContent = "Rechazar";

      reject.addEventListener(
        "click",
        () => respondRequest(id, false)
      );

      card.append(reject);
    });
  }

  async function respondRequest(requestId, accept) {
    try {
      const { error } = await sb.rpc(
        "respond_friend_request",
        {
          p_request_id: requestId,
          p_accept: accept
        }
      );

      if (error) throw error;

      status(
        accept ? "¡Contacto agregado!" : "Solicitud rechazada."
      );

      await Promise.all([
        loadRequests(),
        loadContacts(),
        loadConversations()
      ]);

    } catch (error) {
      console.error("ERROR PROCESANDO SOLICITUD:", error);
      status(error.message, "appStatus", true);
    }
  }

  // =========================================
  // CONTACTOS
  // =========================================

  async function loadContacts() {
    const list = $("contactsList");
    list.innerHTML = "";

    const { data, error } = await sb.rpc(
      "list_familychat_contacts"
    );

    if (error) {
      console.error("ERROR CARGANDO CONTACTOS:", error);
      list.textContent = "No se pudieron cargar los contactos.";
      return;
    }

    contacts = data || [];

    if (!contacts.length) {
      list.textContent = "Todavía no tienes contactos.";
      return;
    }

    contacts.forEach(person => {
      addPersonCard(
        list,
        person,
        "Chatear",
        () => createPrivateChat(person)
      );
    });
  }
