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
    $("loginView")?.classList.remove("hidden");
    $("appView")?.classList.add("hidden");
  }

  function showApp() {
    $("loginView")?.classList.add("hidden");
    $("appView")?.classList.remove("hidden");
  }

  function getPersonId(person) {
    return person?.id ||
      person?.user_id ||
      person?.contact_id ||
      person?.requester_id ||
      null;
  }

  function getPersonName(person) {
    return person?.display_name ||
      person?.username ||
      person?.name ||
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
      if (!profile) throw new Error("No encontramos tu perfil.");

      if (!profile.invite_accepted) {
        showLogin();
        status("Necesitas una invitación válida.", "loginStatus", true);
        return;
      }

      if ($("profileName")) {
        $("profileName").textContent =
          profile.display_name ||
          user.user_metadata?.full_name ||
          "Usuario";
      }

      if ($("profileEmail")) {
        $("profileEmail").textContent = user.email || "";
      }

      if ($("avatar")) {
        $("avatar").src =
          profile.avatar_url ||
          user.user_metadata?.avatar_url ||
          "icon.svg";
      }

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

  function addPersonCard(container, person, buttonText, onAction, detailText = "") {
    if (!container) return null;

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
    if (!$("userSearchInput") || !$("userSearchResults")) return;

    const term = $("userSearchInput").value.trim();
    const results = $("userSearchResults");

    results.innerHTML = "";

    if ($("searchUsersBtn")) {
      $("searchUsersBtn").disabled = true;
    }

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
        addPersonCard(
          results,
          person,
          "Agregar",
          () => sendFriendRequest(getPersonId(person)),
          "Usuario de FamilyChat"
        );
      });

      status(`Se encontraron ${users.length} usuario(s) nuevos.`);

    } catch (error) {
      console.error("ERROR BUSCANDO USUARIOS:", error);
      status("Error al buscar: " + error.message, "appStatus", true);

    } finally {
      if ($("searchUsersBtn")) {
        $("searchUsersBtn").disabled = false;
      }
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
      status("No se pudo enviar la solicitud: " + error.message, "appStatus", true);
    }
  }

  async function loadRequests() {
    const list = $("friendRequestsList");
    if (!list) return;

    list.innerHTML = "";

    const { data, error } = await sb.rpc("list_friend_requests");

    if (error) {
      console.error("ERROR CARGANDO SOLICITUDES:", error);
      list.textContent = "No se pudieron cargar las solicitudes.";
      return;
    }

    const requests = data || [];

    if ($("requestCount")) {
      $("requestCount").textContent =
        requests.length ? `(${requests.length})` : "";
    }

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

      if (!card) return;

      const reject = document.createElement("button");
      reject.type = "button";
      reject.textContent = "Rechazar";
      reject.addEventListener("click", () => respondRequest(id, false));
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

      status(accept ? "¡Contacto agregado!" : "Solicitud rechazada.");

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
    if (!list) return;

    list.innerHTML = "";

    const { data, error } = await sb.rpc("list_familychat_contacts");

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

  // =========================================
  // CONVERSACIONES
  // =========================================

  async function loadConversations() {
    if (!user) return;

    const { data, error } = await sb
      .from("conversation_members")
      .select("conversation_id,conversations(id,title,is_group,created_by)")
      .eq("user_id", user.id);

    if (error) {
      console.error("ERROR CARGANDO CONVERSACIONES:", error);
      status(error.message, "appStatus", true);
      return;
    }

    conversations = (data || [])
      .map(row => row.conversations)
      .filter(Boolean);

    if (active && !conversations.some(item => item.id === active.id)) {
      active = null;

      if (channel) {
        await sb.removeChannel(channel);
        channel = null;
      }

      $("messages")?.replaceChildren();
      $("messages")?.classList.add("hidden");
      $("messageForm")?.classList.add("hidden");
      $("emptyState")?.classList.remove("hidden");

      if ($("chatTitle")) {
        $("chatTitle").textContent = "Selecciona un chat";
      }

      if (deleteChatBtn) {
        deleteChatBtn.hidden = true;
        deleteChatBtn.style.display = "none";
      }
    }

    const list = $("conversationList");
    if (!list) return;

    list.innerHTML = "";

    if (!conversations.length) {
      list.textContent = "Todavía no tienes conversaciones.";
      return;
    }

    conversations.forEach(conversation => {
      const button = document.createElement("button");

      button.className =
        "conversation-item" +
        (active?.id === conversation.id ? " active" : "");

      const icon = document.createElement("span");
      icon.className = "conversation-avatar";
      icon.textContent = conversation.is_group ? "👥" : "💬";

      const title = document.createElement("strong");
      title.textContent = conversation.title || "Conversación";

      button.append(icon, title);
      button.addEventListener("click", () => openChat(conversation));
      list.append(button);
    });
  }

  // =========================================
  // CHAT PRIVADO
  // =========================================

  async function createPrivateChat(person) {
    try {
      const currentUser = await getAuthenticatedUser();
      const otherId = getPersonId(person);

      if (!otherId) {
        throw new Error("No se encontró el identificador del contacto.");
      }

      if (otherId === currentUser.id) {
        throw new Error("No puedes crear un chat contigo mismo.");
      }

      status("Creando chat privado...");

      const { data: conversationId, error } = await sb.rpc(
        "create_familychat_private_chat",
        {
          p_other_user_id: otherId,
          p_title: getPersonName(person)
        }
      );

      if (error) throw error;
      if (!conversationId) throw new Error("Supabase no devolvió el ID del chat.");

      await loadConversations();

      const conversation = conversations.find(item => item.id === conversationId);

      if (!conversation) {
        throw new Error("El chat se creó, pero no aparece en la lista.");
      }

      await openChat(conversation);
      status("¡Chat privado creado correctamente!");

    } catch (error) {
      console.error("ERROR CREANDO CHAT PRIVADO:", error);
      status("No se pudo crear el chat: " + error.message, "appStatus", true);
    }
  }

  // =========================================
  // CREAR GRUPO
  // =========================================

  async function createGroup() {
    try {
      const currentUser = await getAuthenticatedUser();

      if (user && user.id !== currentUser.id) {
        throw new Error("La sesión cambió. Recarga la página.");
      }

      const title = prompt("¿Cómo se llamará el grupo?");
      if (!title || !title.trim()) return;

      const available = contacts.filter(
        person =>
          getPersonId(person) &&
          getPersonId(person) !== currentUser.id
      );

      let selected = [];

      if (available.length) {
        const options = available
          .map((person, index) => `${index + 1}. ${getPersonName(person)}`)
          .join("\n");

        const answer = prompt(
          "Escribe los números de los contactos que quieres incluir, separados por comas.\n" +
          "Déjalo vacío para crear el grupo solo contigo.\n\n" +
          options
        );

        if (answer === null) return;

        if (answer.trim()) {
          const indexes = [
            ...new Set(answer.split(",").map(value => Number(value.trim()) - 1))
          ];

          if (indexes.some(
            index =>
              !Number.isInteger(index) ||
              index < 0 ||
              index >= available.length
          )) {
            throw new Error("Uno de los números no es válido.");
          }

          selected = indexes.map(index => getPersonId(available[index]));
        }
      }

      status("Creando grupo...");

      const { data: conversationId, error } = await sb.rpc(
        "create_familychat_group",
        {
          p_title: title.trim(),
          p_member_ids: selected
        }
      );

      if (error) throw error;
      if (!conversationId) throw new Error("Supabase no devolvió el ID del grupo.");

      await loadConversations();

      const conversation = conversations.find(item => item.id === conversationId);

      if (!conversation) {
        throw new Error("El grupo se creó, pero no aparece en la lista.");
      }

      await openChat(conversation);
      status("¡Grupo creado correctamente!");

    } catch (error) {
      console.error("ERROR CREANDO GRUPO:", error);
      status("No se pudo crear el grupo: " + error.message, "appStatus", true);
    }
  }

  // =========================================
  // AGREGAR MIEMBROS A GRUPO
  // =========================================

  async function addGroupMember() {
    if (!active?.is_group) return;

    try {
      const currentUser = await getAuthenticatedUser();

      if (active.created_by !== currentUser.id) {
        throw new Error("Solo quien creó el grupo puede agregar miembros.");
      }

      const { data: currentMembers, error: membersError } = await sb
        .from("conversation_members")
        .select("user_id")
        .eq("conversation_id", active.id);

      if (membersError) throw membersError;

      const memberIds = new Set((currentMembers || []).map(row => row.user_id));

      const available = contacts.filter(
        person =>
          getPersonId(person) &&
          !memberIds.has(getPersonId(person)) &&
          getPersonId(person) !== currentUser.id
      );

      if (!available.length) {
        status("No tienes contactos nuevos para agregar.");
        return;
      }

      const options = available
        .map((person, index) => `${index + 1}. ${getPersonName(person)}`)
        .join("\n");

      const answer = prompt(
        "Escribe el número del contacto que quieres agregar:\n\n" + options
      );

      if (!answer) return;

      const index = Number(answer) - 1;

      if (!Number.isInteger(index) || index < 0 || index >= available.length) {
        throw new Error("Número de contacto no válido.");
      }

      const person = available[index];

      const { error } = await sb.rpc(
        "add_familychat_group_member",
        {
          p_conversation_id: active.id,
          p_member_id: getPersonId(person)
        }
      );

      if (error) throw error;

      await loadConversations();
      status(`¡${getPersonName(person)} fue agregado al grupo!`);

    } catch (error) {
      console.error("ERROR AGREGANDO MIEMBRO:", error);
      status("No se pudo agregar a esta persona: " + error.message, "appStatus", true);
    }
  }

  // =========================================
  // BOTÓN BORRAR CHAT
  // =========================================

  function createDeleteButton() {
    if (deleteChatBtn) return deleteChatBtn;

    deleteChatBtn = document.createElement("button");
    deleteChatBtn.id = "deleteChatBtn";
    deleteChatBtn.type = "button";
    deleteChatBtn.textContent = "🗑️ Borrar chat";
    deleteChatBtn.title = "Eliminar este chat para todos";

    Object.assign(deleteChatBtn.style, {
      display: "none",
      visibility: "visible",
      background: "#8b3fa8",
      color: "#ffffff",
      border: "none",
      borderRadius: "9px",
      padding: "10px 14px",
      margin: "10px 0 10px 12px",
      cursor: "pointer",
      fontWeight: "bold",
      flexShrink: "0"
    });

    deleteChatBtn.addEventListener("click", deleteActiveChat);
    return deleteChatBtn;
  }

  function showDeleteButton() {
    const button = createDeleteButton();
    const title = $("chatTitle");
    if (!title) return;

    button.style.display = "inline-flex";
    button.hidden = false;

    const header = title.parentElement;

    if (header) {
      if (getComputedStyle(header).display === "block") {
        header.style.display = "flex";
        header.style.alignItems = "center";
        header.style.flexWrap = "wrap";
      }

      if (title.nextElementSibling !== button) {
        title.insertAdjacentElement("afterend", button);
      }
    }
  }

  // =========================================
  // ABRIR CHAT
  // =========================================

  async function openChat(conversation) {
    active = conversation;

    if ($("chatTitle")) {
      $("chatTitle").textContent = conversation.title || "Conversación";
    }

    showDeleteButton();

    $("emptyState")?.classList.add("hidden");
    $("messages")?.classList.remove("hidden");
    $("messageForm")?.classList.remove("hidden");

    if ($("addGroupMemberBtn")) {
      $("addGroupMemberBtn").classList.toggle("hidden", !conversation.is_group);
    }

    await loadMessages();

    if (channel) {
      await sb.removeChannel(channel);
      channel = null;
    }

    channel = sb
      .channel("chat-" + conversation.id)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: "conversation_id=eq." + conversation.id
        },
        () => loadMessages()
      )
      .subscribe();

    await loadConversations();
  }

  // =========================================
  // BORRAR CHAT PARA TODOS
  // =========================================

  async function deleteActiveChat() {
    if (!active || !deleteChatBtn) return;

    const conversation = active;

    const confirmed = confirm(
      `¿Seguro que quieres borrar "${conversation.title || "este chat"}"?\n\n` +
      "Se eliminará para TODOS los participantes y se borrarán sus mensajes. Esta acción no se puede deshacer."
    );

    if (!confirmed) return;

    try {
      deleteChatBtn.disabled = true;
      status("Eliminando chat para todos...");

      const { data, error } = await sb.rpc(
        "delete_familychat_conversation",
        { p_conversation_id: conversation.id }
      );

      if (error) throw error;
      if (data !== true) throw new Error("Supabase no confirmó la eliminación.");

      if (channel) {
        await sb.removeChannel(channel);
        channel = null;
      }

      active = null;

      $("messages")?.replaceChildren();
      $("messages")?.classList.add("hidden");
      $("messageForm")?.classList.add("hidden");
      $("emptyState")?.classList.remove("hidden");

      if ($("chatTitle")) {
        $("chatTitle").textContent = "Selecciona un chat";
      }

      deleteChatBtn.style.display = "none";
      deleteChatBtn.hidden = true;

      await loadConversations();
      status("Chat eliminado para todos.");

    } catch (error) {
      console.error("ERROR BORRANDO CHAT:", error);
      status("No se pudo borrar el chat: " + error.message, "appStatus", true);

    } finally {
      if (deleteChatBtn) deleteChatBtn.disabled = false;
    }
  }

  // =========================================
  // CARGAR MENSAJES
  // =========================================

  async function loadMessages() {
    if (!active || !user) return;

    const conversationId = active.id;

    const { data, error } = await sb
      .from("messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(200);

    if (error) {
      console.error("ERROR CARGANDO MENSAJES:", error);
      status(error.message, "appStatus", true);
      return;
    }

    if (!active || active.id !== conversationId) return;

    const box = $("messages");
    if (!box) return;

    box.innerHTML = "";

    (data || []).forEach(message => {
      const item = document.createElement("div");

      item.className =
        "message" +
        (message.sender_id === user.id ? " mine" : "");

      const body = document.createElement("div");
      body.textContent = message.body || "";

      const time = document.createElement("small");
      time.textContent = message.created_at
        ? new Date(message.created_at).toLocaleString()
        : "";

      item.append(body, time);
      box.append(item);
    });

    box.scrollTop = box.scrollHeight;
  }

  // =========================================
  // ENVIAR MENSAJES
  // =========================================

  async function sendMessage(event) {
    event.preventDefault();
    if (!active) return;

    const currentUser = await getAuthenticatedUser();
    const input = $("messageInput");
    if (!input) return;

    const body = input.value.trim();
    if (!body) return;

    const conversationId = active.id;
    input.value = "";

    const { error } = await sb
      .from("messages")
      .insert({
        conversation_id: conversationId,
        sender_id: currentUser.id,
        body
      });

    if (error) {
      input.value = body;
      console.error("ERROR ENVIANDO MENSAJE:", error);
      status(error.message, "appStatus", true);
    } else {
      await loadMessages();
    }
  }

  // =========================================
  // JUEGOS: INTERFAZ
  // =========================================

  let gamesOverlay = null;
  let gameCanvas = null;
  let gameContext = null;
  let gameAnimation = null;
  let gameRunning = false;
  let gameKeys = {};
  let currentGame = "";
  let gameState = {};
  let gameLastTime = 0;

  function createGamesUI() {
    if (gamesOverlay) return;

    const style = document.createElement("style");

    style.textContent = `
      #familyGamesOverlay {
        position: fixed;
        inset: 0;
        z-index: 99999;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 14px;
        box-sizing: border-box;
        background: rgba(25,23,31,.95);
        font-family: 'DM Sans', sans-serif;
      }

      #familyGamesOverlay.visible {
        display: flex;
      }

      .fc-game-card {
        width: min(950px,100%);
        max-height: 95vh;
        overflow-y: auto;
        background: #f7f6f8;
        color: #292730;
        border: 1px solid #dedce3;
        border-radius: 18px;
        padding: 18px;
        box-sizing: border-box;
      }

      .fc-game-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
        margin-bottom: 14px;
      }

      .fc-game-top h2 {
        margin: 0;
        color: #8052b8;
      }

      .fc-game-button {
        border: 0;
        border-radius: 10px;
        background: #8052b8;
        color: white;
        padding: 10px 15px;
        font-weight: bold;
        cursor: pointer;
      }

      .fc-game-button:hover {
        background: #693e9e;
      }

      .fc-game-menu {
        display: grid;
        grid-template-columns: repeat(auto-fit,minmax(145px,1fr));
        gap: 12px;
      }

      .fc-game-choice {
        min-height: 125px;
        border: 1px solid #dedce3;
        border-radius: 14px;
        background: white;
        color: #292730;
        font-size: 16px;
        font-weight: bold;
        cursor: pointer;
        padding: 15px;
      }

      .fc-game-choice span {
        display: block;
        font-size: 35px;
        margin-bottom: 9px;
      }

      .fc-game-choice:hover {
        border-color: #8052b8;
        background: #eee7f6;
      }

      #familyGameCanvas {
        display: block;
        width: 100%;
        max-height: 55vh;
        aspect-ratio: 16/9;
        background: #252333;
        border: 3px solid #8052b8;
        border-radius: 12px;
        touch-action: none;
      }

      .fc-game-info {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        flex-wrap: wrap;
        margin: 12px 0;
        font-weight: bold;
      }

      .fc-game-controls {
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 12px;
        margin-top: 12px;
      }

      .fc-game-controls button {
        width: 64px;
        height: 52px;
        border: 0;
        border-radius: 12px;
        background: #eee7f6;
        color: #58347f;
        font-size: 23px;
        font-weight: bold;
        touch-action: none;
      }

      .fc-game-help {
        color: #77717f;
        font-size: 13px;
        text-align: center;
        margin-top: 12px;
      }

      #fcGameMessage {
        text-align: center;
        color: #8052b8;
        font-weight: bold;
        min-height: 22px;
      }

      @media (min-width: 800px) {
        .fc-game-controls {
          display: none;
        }
      }
    `;

    document.head.appendChild(style);

    gamesOverlay = document.createElement("div");
    gamesOverlay.id = "familyGamesOverlay";

    gamesOverlay.innerHTML = `
      <div class="fc-game-card">
        <div class="fc-game-top">
          <h2 id="fcGameTitle">🎮 Juegos FamilyChat</h2>
          <div>
            <button type="button" class="fc-game-button" id="fcMenuGames">
              Juegos
            </button>
            <button type="button" class="fc-game-button" id="fcCloseGames">
              ✕ Volver al chat
            </button>
          </div>
        </div>

        <div id="fcGameMenu" class="fc-game-menu">
          <button class="fc-game-choice" data-game="adventure">
            <span>⭐</span>Aventura Pixel
          </button>
          <button class="fc-game-choice" data-game="snake">
            <span>🐍</span>Snake
          </button>
          <button class="fc-game-choice" data-game="tictactoe">
            <span>❌</span>Tres en raya
          </button>
          <button class="fc-game-choice" data-game="zombies">
            <span>🧟</span>Zombis
          </button>
          <button class="fc-game-choice" data-game="arkanoid">
            <span>🧱</span>Arkanoid
          </button>
        </div>

        <div id="fcGameArea" hidden>
          <div class="fc-game-info">
            <span>⭐ Puntos: <span id="fcGameScore">0</span></span>
            <span id="fcGameInfo">¡A jugar!</span>
            <button type="button" class="fc-game-button" id="fcRestartGame">
              ↻ Reiniciar
            </button>
          </div>

          <canvas id="familyGameCanvas" width="800" height="450"></canvas>

          <p id="fcGameMessage"></p>

          <div class="fc-game-controls">
            <button type="button" id="fcLeft">◀</button>
            <button type="button" id="fcJump">▲</button>
            <button type="button" id="fcRight">▶</button>
          </div>

          <p class="fc-game-help">
            Usa las flechas o A y D para moverte. En el teléfono utiliza los botones.
          </p>
        </div>
      </div>
    `;

    document.body.appendChild(gamesOverlay);

    gameCanvas = $("familyGameCanvas");
    gameContext = gameCanvas.getContext("2d");

    $("fcCloseGames").addEventListener("click", hideGames);
    $("fcMenuGames").addEventListener("click", showGameMenu);
    $("fcRestartGame").addEventListener("click", restartCurrentGame);

    gamesOverlay.querySelectorAll("[data-game]").forEach(button => {
      button.addEventListener("click", () => startSelectedGame(button.dataset.game));
    });

    bindGameButton("fcLeft", "left");
    bindGameButton("fcRight", "right");
    bindGameButton("fcJump", "jump");

    window.addEventListener("keydown", event => {
      if (!gamesOverlay?.classList.contains("visible")) return;

      const key = event.key.toLowerCase();

      if ([
        "arrowleft", "arrowright", "arrowup",
        "arrowdown", " ", "a", "d", "w", "s"
      ].includes(key)) {
        event.preventDefault();
      }

      gameKeys[key] = true;

      if (currentGame === "snake") {
        if (key === "arrowup" || key === "w") setSnakeDirection(0, -1);
        if (key === "arrowdown" || key === "s") setSnakeDirection(0, 1);
        if (key === "arrowleft" || key === "a") setSnakeDirection(-1, 0);
        if (key === "arrowright" || key === "d") setSnakeDirection(1, 0);
      }

      if (currentGame === "tictactoe" && key === "enter") {
        restartCurrentGame();
      }
    });

    window.addEventListener("keyup", event => {
      gameKeys[event.key.toLowerCase()] = false;
    });

    gameCanvas.addEventListener("pointerdown", handleGamePointer);
  }

  function bindGameButton(id, key) {
    const button = $(id);
    if (!button) return;

    const press = event => {
      event.preventDefault();
      gameKeys[key] = true;
    };

    const release = event => {
      event.preventDefault();
      gameKeys[key] = false;
    };

    button.addEventListener("pointerdown", press);
    button.addEventListener("pointerup", release);
    button.addEventListener("pointerleave", release);
    button.addEventListener("pointercancel", release);
  }

  function showGames() {
    createGamesUI();
    gamesOverlay.classList.add("visible");
    document.body.style.overflow = "hidden";
    showGameMenu();
  }

  function hideGames() {
    if (!gamesOverlay) return;
    gamesOverlay.classList.remove("visible");
    document.body.style.overflow = "";
    stopGame();
  }

  function showGameMenu() {
    stopGame();
    currentGame = "";
    $("fcGameMenu").hidden = false;
    $("fcGameArea").hidden = true;
    $("fcGameTitle").textContent = "🎮 Juegos FamilyChat";
  }

  function startSelectedGame(name) {
    stopGame();

    currentGame = name;
    gameKeys = {};
    gameLastTime = 0;

    $("fcGameMenu").hidden = true;
    $("fcGameArea").hidden = false;
    $("fcGameMessage").textContent = "";

    const titles = {
      adventure: "⭐ Aventura Pixel",
      snake: "🐍 Snake",
      tictactoe: "❌ Tres en raya",
      zombies: "🧟 Zombis",
      arkanoid: "🧱 Arkanoid"
    };

    $("fcGameTitle").textContent = titles[name] || "Juegos";
    restartCurrentGame();
  }

  function restartCurrentGame() {
    if (!currentGame) return;

    stopGame();
    gameKeys = {};
    gameLastTime = 0;

    if (currentGame === "adventure") initAdventure();
    if (currentGame === "snake") initSnake();
    if (currentGame === "tictactoe") initTicTacToe();
    if (currentGame === "zombies") initZombies();
    if (currentGame === "arkanoid") initArkanoid();

    if (currentGame !== "tictactoe") {
      gameRunning = true;
      gameAnimation = requestAnimationFrame(gameLoop);
    }

    drawGame();
  }

  function stopGame() {
    gameRunning = false;

    if (gameAnimation) {
      cancelAnimationFrame(gameAnimation);
      gameAnimation = null;
    }
  }

  function setScore(value) {
    gameState.score = value;
    if ($("fcGameScore")) {
      $("fcGameScore").textContent = String(value);
    }
  }

  function setMessage(message) {
    if ($("fcGameMessage")) {
      $("fcGameMessage").textContent = message;
    }
  }

  // =========================================
  // AVENTURA PIXEL
  // =========================================

  function initAdventure() {
    setScore(0);
    $("fcGameInfo").textContent = "Recoge las estrellas y evita caer.";

    gameState = {
      player: {
        x: 70, y: 320, width: 34, height: 42,
        vx: 0, vy: 0, speed: 4, jump: -12, grounded: false
      },
      platforms: [
        { x: 0, y: 410, width: 800, height: 40 },
        { x: 150, y: 330, width: 150, height: 16 },
        { x: 370, y: 270, width: 150, height: 16 },
        { x: 590, y: 210, width: 140, height: 16 },
        { x: 330, y: 150, width: 130, height: 16 }
      ],
      stars: [
        { x: 210, y: 290, taken: false },
        { x: 430, y: 230, taken: false },
        { x: 650, y: 170, taken: false },
        { x: 390, y: 110, taken: false },
        { x: 720, y: 370, taken: false },
        { x: 100, y: 370, taken: false }
      ]
    };
  }

  function updateAdventure(delta) {
    const p = gameState.player;

    const left = gameKeys.left || gameKeys.arrowleft || gameKeys.a;
    const right = gameKeys.right || gameKeys.arrowright || gameKeys.d;
    const jump = gameKeys.jump || gameKeys.arrowup || gameKeys.w || gameKeys[" "];

    p.vx = left ? -p.speed : right ? p.speed : 0;

    if (jump && p.grounded) {
      p.vy = p.jump;
      p.grounded = false;
    }

    p.x += p.vx * delta;
    p.vy += 0.55 * delta;
    p.y += p.vy * delta;

    p.x = Math.max(0, Math.min(800 - p.width, p.x));

    p.grounded = false;

    gameState.platforms.forEach(platform => {
      const previousBottom = p.y + p.height - p.vy * delta;
      const currentBottom = p.y + p.height;

      const overlap =
        p.x + p.width > platform.x &&
        p.x < platform.x + platform.width;

      if (
        overlap &&
        p.vy >= 0 &&
        previousBottom <= platform.y + 5 &&
        currentBottom >= platform.y
      ) {
        p.y = platform.y - p.height;
        p.vy = 0;
        p.grounded = true;
      }
    });

    gameState.stars.forEach(star => {
      if (star.taken) return;

      const dx = p.x + p.width / 2 - star.x;
      const dy = p.y + p.height / 2 - star.y;

      if (Math.hypot(dx, dy) < 30) {
        star.taken = true;
        setScore((gameState.score || 0) + 10);
      }
    });

    if (p.y > 460) {
      p.x = 70;
      p.y = 320;
      p.vy = 0;
    }

    if (gameState.stars.every(star => star.taken)) {
      gameState.stars.forEach(star => star.taken = false);
      setScore(gameState.score + 50);
    }
  }

  function drawAdventure(ctx) {
    drawBackground(ctx);

    gameState.platforms.forEach(platform => {
      ctx.fillStyle = "#8052b8";
      ctx.fillRect(platform.x, platform.y, platform.width, platform.height);
      ctx.fillStyle = "#c7a5ee";
      ctx.fillRect(platform.x, platform.y, platform.width, 4);
    });

    gameState.stars.forEach(star => {
      if (star.taken) return;
      ctx.fillStyle = "#ffd95a";
      ctx.font = "28px Arial";
      ctx.textAlign = "center";
      ctx.fillText("★", star.x, star.y + 8);
    });

    const p = gameState.player;

    ctx.fillStyle = "#f0c7ff";
    ctx.fillRect(p.x, p.y, p.width, p.height);

    ctx.fillStyle = "#8052b8";
    ctx.fillRect(p.x + 5, p.y + 8, 7, 7);
    ctx.fillRect(p.x + 22, p.y + 8, 7, 7);

    ctx.fillStyle = "#292730";
    ctx.fillRect(p.x + 9, p.y + 28, 16, 4);
  }

  // =========================================
  // SNAKE
  // =========================================

  function initSnake() {
    setScore(0);
    $("fcGameInfo").textContent = "Come la fruta. No choques con tu cuerpo.";

    gameState = {
      snake: [
        { x: 10, y: 10 },
        { x: 9, y: 10 },
        { x: 8, y: 10 }
      ],
      direction: { x: 1, y: 0 },
      nextDirection: { x: 1, y: 0 },
      food: { x: 15, y: 10 },
      timer: 0,
      speed: 8,
      over: false
    };

    placeSnakeFood();
  }

  function setSnakeDirection(x, y) {
    if (!gameState.snake) return;

    const current = gameState.direction;

    if (current.x + x === 0 && current.y + y === 0) return;

    gameState.nextDirection = { x, y };
  }

  function placeSnakeFood() {
    let food;

    do {
      food = {
        x: Math.floor(Math.random() * 25),
        y: Math.floor(Math.random() * 14)
      };
    } while (
      gameState.snake.some(part => part.x === food.x && part.y === food.y)
    );

    gameState.food = food;
  }

  function updateSnake(delta) {
    if (gameState.over) return;

    gameState.timer += delta;

    if (gameState.timer < gameState.speed) return;
    gameState.timer = 0;

    gameState.direction = { ...gameState.nextDirection };

    const head = gameState.snake[0];

    const next = {
      x: head.x + gameState.direction.x,
      y: head.y + gameState.direction.y
    };

    if (
      next.x < 0 || next.x >= 25 ||
      next.y < 0 || next.y >= 14 ||
      gameState.snake.some(part => part.x === next.x && part.y === next.y)
    ) {
      gameState.over = true;
      setMessage("¡Fin del juego! Pulsa Reiniciar.");
      return;
    }

    gameState.snake.unshift(next);

    if (next.x === gameState.food.x && next.y === gameState.food.y) {
      setScore(gameState.score + 10);
      placeSnakeFood();
      gameState.speed = Math.max(4, gameState.speed - 0.15);
    } else {
      gameState.snake.pop();
    }
  }

  function drawSnake(ctx) {
    ctx.fillStyle = "#242232";
    ctx.fillRect(0, 0, 800, 450);

    const cellW = 32;
    const cellH = 32;
    const offsetX = 0;
    const offsetY = 1;

    ctx.fillStyle = "#f04f6f";
    ctx.fillRect(
      offsetX + gameState.food.x * cellW + 4,
      offsetY + gameState.food.y * cellH + 4,
      cellW - 8,
      cellH - 8
    );

    gameState.snake.forEach((part, index) => {
      ctx.fillStyle = index === 0 ? "#c7a5ee" : "#8052b8";
      ctx.fillRect(
        offsetX + part.x * cellW + 2,
        offsetY + part.y * cellH + 2,
        cellW - 4,
        cellH - 4
      );
    });

    if (gameState.over) {
      drawCenterText(ctx, "FIN DEL JUEGO", 225);
    }
  }

  // =========================================
  // TRES EN RAYA
  // =========================================

  function initTicTacToe() {
    stopGame();
    setScore(0);
    $("fcGameInfo").textContent = "Turno de X";
    gameState = {
      board: Array(9).fill(""),
      turn: "X",
      over: false
    };
    drawGame();
  }

  function handleTicTacToePointer(x, y) {
    if (gameState.over) return;

    const size = 300;
    const left = 250;
    const top = 75;

    if (x < left || x > left + size || y < top || y > top + size) return;

    const col = Math.min(2, Math.floor((x - left) / 100));
    const row = Math.min(2, Math.floor((y - top) / 100));
    const index = row * 3 + col;

    if (gameState.board[index]) return;

    gameState.board[index] = gameState.turn;

    const winner = checkWinner(gameState.board);

    if (winner) {
      gameState.over = true;
      $("fcGameInfo").textContent = `¡Ganó ${winner}!`;
      setMessage(`¡Ganó ${winner}! Pulsa Reiniciar para otra partida.`);
    } else if (gameState.board.every(Boolean)) {
      gameState.over = true;
      $("fcGameInfo").textContent = "Empate";
      setMessage("¡Empate! Pulsa Reiniciar.");
    } else {
      gameState.turn = gameState.turn === "X" ? "O" : "X";
      $("fcGameInfo").textContent = `Turno de ${gameState.turn}`;
    }

    drawGame();
  }

  function checkWinner(board) {
    const lines = [
      [0, 1, 2], [3, 4, 5], [6, 7, 8],
      [0, 3, 6], [1, 4, 7], [2, 5, 8],
      [0, 4, 8], [2, 4, 6]
    ];

    for (const line of lines) {
      const [a, b, c] = line;
      if (board[a] && board[a] === board[b] && board[a] === board[c]) {
        return board[a];
      }
    }

    return null;
  }

  function drawTicTacToe(ctx) {
    ctx.fillStyle = "#292730";
    ctx.fillRect(0, 0, 800, 450);

    ctx.strokeStyle = "#c7a5ee";
    ctx.lineWidth = 7;

    ctx.beginPath();
    ctx.moveTo(350, 75);
    ctx.lineTo(350, 375);
    ctx.moveTo(450, 75);
    ctx.lineTo(450, 375);
    ctx.moveTo(250, 175);
    ctx.lineTo(550, 175);
    ctx.moveTo(250, 275);
    ctx.lineTo(550, 275);
    ctx.stroke();

    gameState.board.forEach((value, index) => {
      if (!value) return;

      const row = Math.floor(index / 3);
      const col = index % 3;

      ctx.fillStyle = value === "X" ? "#f0c7ff" : "#ffd95a";
      ctx.font = "70px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(value, 300 + col * 100, 125 + row * 100);
    });

    if (gameState.over) {
      drawCenterText(ctx, "PARTIDA TERMINADA", 420);
    }
  }

  // =========================================
  // ZOMBIS
  // =========================================

  function initZombies() {
    setScore(0);
    $("fcGameInfo").textContent = "Muévete y dispara con el botón ▲ o la barra espaciadora.";

    gameState = {
      player: { x: 400, y: 370, width: 30, height: 30 },
      zombies: [],
      bullets: [],
      spawn: 0,
      health: 3,
      over: false
    };

    setMessage("¡Sobrevive a los zombis!");
  }

  function updateZombies(delta) {
    if (gameState.over) return;

    const p = gameState.player;

    if (gameKeys.left || gameKeys.arrowleft || gameKeys.a) p.x -= 5 * delta;
    if (gameKeys.right || gameKeys.arrowright || gameKeys.d) p.x += 5 * delta;
    if (gameKeys.up || gameKeys.w || gameKeys.arrowup) p.y -= 5 * delta;
    if (gameKeys.down || gameKeys.s || gameKeys.arrowdown) p.y += 5 * delta;

    p.x = Math.max(15, Math.min(785, p.x));
    p.y = Math.max(15, Math.min(435, p.y));

    gameState.spawn += delta;

    if (gameState.spawn > 55) {
      gameState.spawn = 0;

      const side = Math.floor(Math.random() * 4);

      gameState.zombies.push({
        x: side === 0 ? 0 : side === 1 ? 800 : Math.random() * 800,
        y: side === 2 ? 0 : side === 3 ? 450 : Math.random() * 450,
        speed: 0.7 + Math.random() * 0.6
      });
    }

    gameState.zombies.forEach(zombie => {
      const dx = p.x - zombie.x;
      const dy = p.y - zombie.y;
      const distance = Math.hypot(dx, dy) || 1;

      zombie.x += (dx / distance) * zombie.speed * delta;
      zombie.y += (dy / distance) * zombie.speed * delta;

      if (distance < 25) {
        gameState.health--;
        zombie.x = -100;

        if (gameState.health <= 0) {
          gameState.over = true;
          setMessage("¡Te atraparon! Pulsa Reiniciar.");
        }
      }
    });

    gameState.zombies = gameState.zombies.filter(z => z.x > -50);

    gameState.bullets.forEach(bullet => {
      bullet.x += bullet.vx * delta;
      bullet.y += bullet.vy * delta;

      gameState.zombies.forEach(zombie => {
        if (Math.hypot(bullet.x - zombie.x, bullet.y - zombie.y) < 22) {
          zombie.x = -100;
          bullet.dead = true;
          setScore(gameState.score + 10);
        }
      });
    });

    gameState.bullets = gameState.bullets.filter(
      bullet =>
        !bullet.dead &&
        bullet.x >= 0 && bullet.x <= 800 &&
        bullet.y >= 0 && bullet.y <= 450
    );
  }

  function shootZombie() {
    if (currentGame !== "zombies" || gameState.over) return;

    const p = gameState.player;

    gameState.bullets.push({
      x: p.x,
      y: p.y - 12,
      vx: 0,
      vy: -8,
      dead: false
    });
  }

  function drawZombies(ctx) {
    ctx.fillStyle = "#202a26";
    ctx.fillRect(0, 0, 800, 450);

    ctx.fillStyle = "#c7a5ee";
    ctx.beginPath();
    ctx.arc(gameState.player.x, gameState.player.y, 17, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#e7d9f5";
    gameState.zombies.forEach(zombie => {
      ctx.beginPath();
      ctx.arc(zombie.x, zombie.y, 17, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.fillStyle = "#ffd95a";
    gameState.bullets.forEach(bullet => {
      ctx.beginPath();
      ctx.arc(bullet.x, bullet.y, 5, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.fillStyle = "white";
    ctx.font = "20px Arial";
    ctx.textAlign = "left";
    ctx.fillText("❤️".repeat(Math.max(0, gameState.health)), 15, 30);

    if (gameState.over) {
      drawCenterText(ctx, "FIN DEL JUEGO", 225);
    }
  }

  // =========================================
  // ARKANOID
  // =========================================

  function initArkanoid() {
    setScore(0);
    $("fcGameInfo").textContent = "Mueve la barra para rebotar la pelota.";

    gameState = {
      paddle: { x: 340, y: 415, width: 120, height: 14 },
      ball: { x: 400, y: 380, vx: 4, vy: -4, radius: 9 },
      bricks: [],
      lives: 3,
      over: false
    };

    createBricks();
  }

  function createBricks() {
    gameState.bricks = [];

    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 10; col++) {
        gameState.bricks.push({
          x: 35 + col * 74,
          y: 45 + row * 34,
          width: 64,
          height: 22,
          alive: true
        });
      }
    }
  }

  function updateArkanoid(delta) {
    if (gameState.over) return;

    const paddle = gameState.paddle;
    const ball = gameState.ball;

    if (gameKeys.left || gameKeys.arrowleft || gameKeys.a) paddle.x -= 7 * delta;
    if (gameKeys.right || gameKeys.arrowright || gameKeys.d) paddle.x += 7 * delta;

    paddle.x = Math.max(0, Math.min(800 - paddle.width, paddle.x));

    ball.x += ball.vx * delta;
    ball.y += ball.vy * delta;

    if (ball.x < ball.radius || ball.x > 800 - ball.radius) {
      ball.vx *= -1;
    }

    if (ball.y < ball.radius) {
      ball.vy *= -1;
    }

    if (
      ball.vy > 0 &&
      ball.y + ball.radius >= paddle.y &&
      ball.x >= paddle.x &&
      ball.x <= paddle.x + paddle.width
    ) {
      ball.vy = -Math.abs(ball.vy);
      ball.vx = ((ball.x - (paddle.x + paddle.width / 2)) / (paddle.width / 2)) * 5;
    }

    if (ball.y > 455) {
      gameState.lives--;

      if (gameState.lives <= 0) {
        gameState.over = true;
        setMessage("¡Sin vidas! Pulsa Reiniciar.");
      } else {
        ball.x = 400;
        ball.y = 380;
        ball.vx = 4;
        ball.vy = -4;
      }
    }

    gameState.bricks.forEach(brick => {
      if (!brick.alive) return;

      if (
        ball.x + ball.radius > brick.x &&
        ball.x - ball.radius < brick.x + brick.width &&
        ball.y + ball.radius > brick.y &&
        ball.y - ball.radius < brick.y + brick.height
      ) {
        brick.alive = false;
        ball.vy *= -1;
        setScore(gameState.score + 10);
      }
    });

    if (gameState.bricks.every(brick => !brick.alive)) {
      createBricks();
      ball.vx *= 1.1;
      ball.vy *= 1.1;
      setMessage("¡Nivel superado!");
    }

    $("fcGameInfo").textContent = `Vidas: ${gameState.lives}`;
  }

  function drawArkanoid(ctx) {
    ctx.fillStyle = "#252333";
    ctx.fillRect(0, 0, 800, 450);

    gameState.bricks.forEach((brick, index) => {
      if (!brick.alive) return;

      const colors = ["#8052b8", "#9a6acb", "#b28bda", "#d0b3ec"];
      ctx.fillStyle = colors[Math.floor(index / 10) % colors.length];
      ctx.fillRect(brick.x, brick.y, brick.width, brick.height);
    });

    ctx.fillStyle = "#c7a5ee";
    ctx.fillRect(
      gameState.paddle.x,
      gameState.paddle.y,
      gameState.paddle.width,
      gameState.paddle.height
    );

    ctx.fillStyle = "#ffd95a";
    ctx.beginPath();
    ctx.arc(
      gameState.ball.x,
      gameState.ball.y,
      gameState.ball.radius,
      0,
      Math.PI * 2
    );
    ctx.fill();

    if (gameState.over) {
      drawCenterText(ctx, "FIN DEL JUEGO", 225);
    }
  }

  // =========================================
  // DIBUJO GENERAL
  // =========================================

  function drawBackground(ctx) {
    const gradient = ctx.createLinearGradient(0, 0, 0, 450);
    gradient.addColorStop(0, "#29263c");
    gradient.addColorStop(1, "#51406c");

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 800, 450);

    ctx.fillStyle = "rgba(255,255,255,.7)";

    for (let i = 0; i < 45; i++) {
      ctx.fillRect((i * 137) % 800, (i * 73) % 400, 2, 2);
    }
  }

  function drawCenterText(ctx, text, y) {
    ctx.fillStyle = "rgba(20,18,28,.65)";
    ctx.fillRect(150, y - 45, 500, 75);

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 30px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 400, y - 7);
  }

  function updateGame(delta) {
    if (currentGame === "adventure") updateAdventure(delta);
    if (currentGame === "snake") updateSnake(delta);
    if (currentGame === "zombies") updateZombies(delta);
    if (currentGame === "arkanoid") updateArkanoid(delta);
  }

  function drawGame() {
    if (!gameContext || !gameCanvas) return;

    const ctx = gameContext;
    ctx.clearRect(0, 0, 800, 450);

    if (currentGame === "adventure") drawAdventure(ctx);
    if (currentGame === "snake") drawSnake(ctx);
    if (currentGame === "tictactoe") drawTicTacToe(ctx);
    if (currentGame === "zombies") drawZombies(ctx);
    if (currentGame === "arkanoid") drawArkanoid(ctx);
  }

  function gameLoop(timestamp) {
    if (!gameRunning) return;

    const delta = gameLastTime
      ? Math.min((timestamp - gameLastTime) / 16.67, 2)
      : 1;

    gameLastTime = timestamp;

    updateGame(delta);
    drawGame();

    gameAnimation = requestAnimationFrame(gameLoop);
  }

  function handleGamePointer(event) {
    if (!currentGame) return;

    const rect = gameCanvas.getBoundingClientRect();

    const x = (event.clientX - rect.left) * (800 / rect.width);
    const y = (event.clientY - rect.top) * (450 / rect.height);

    if (currentGame === "tictactoe") {
      handleTicTacToePointer(x, y);
    }

    if (currentGame === "zombies") {
      shootZombie();
    }

    if (currentGame === "arkanoid") {
      gameState.paddle.x = Math.max(
        0,
        Math.min(800 - gameState.paddle.width, x - gameState.paddle.width / 2)
      );
    }
  }

  // =========================================
  // ACTUALIZACIÓN AUTOMÁTICA
  // =========================================

  function startRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);

    refreshTimer = window.setInterval(async () => {
      if (!user || busy) return;

      busy = true;

      try {
        await Promise.all([
          loadContacts(),
          loadRequests(),
          loadConversations()
        ]);

        if (active) await loadMessages();

      } catch (error) {
        console.warn("ERROR ACTUALIZANDO:", error);

      } finally {
        busy = false;
      }
    }, 10000);
  }

  // =========================================
  // CERRAR SESIÓN
  // =========================================

  async function logout() {
    if (channel) {
      await sb.removeChannel(channel);
      channel = null;
    }

    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }

    hideGames();

    await sb.auth.signOut();

    user = null;
    active = null;
    contacts = [];
    conversations = [];

    if (deleteChatBtn) {
      deleteChatBtn.style.display = "none";
      deleteChatBtn.hidden = true;
    }

    showLogin();
  }

  // =========================================
  // DISEÑO Y ESPACIO DE CHATS
  // =========================================

  const chatLayoutStyle = document.createElement("style");

  chatLayoutStyle.textContent = `
    #conversationList {
      min-height: 0;
      max-height: 65vh;
      overflow-y: auto;
      scrollbar-width: thin;
      flex: 1 1 auto;
    }

    #contactsList {
      max-height: 150px;
      overflow-y: auto;
      scrollbar-width: thin;
    }

    .conversation-item {
      width: 100%;
      box-sizing: border-box;
    }

    #conversationList::-webkit-scrollbar,
    #contactsList::-webkit-scrollbar {
      width: 6px;
    }

    #conversationList::-webkit-scrollbar-thumb,
    #contactsList::-webkit-scrollbar-thumb {
      background: #8b3fa8;
      border-radius: 10px;
    }

    #deleteChatBtn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      position: relative;
      z-index: 10;
    }

    #deleteChatBtn:hover {
      background: #71318b !important;
    }

    #deleteChatBtn:disabled {
      opacity: .6;
      cursor: wait;
    }

    .sidebar {
      min-height: 0;
    }

    #newGroupBtn,
    #gamesBtn {
      flex-shrink: 0;
      position: relative;
      z-index: 2;
    }
  `;

  document.head.appendChild(chatLayoutStyle);

  // =========================================
  // INICIAR APLICACIÓN
  // =========================================

  async function init() {
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_PUBLISHABLE_KEY) {
      status("Falta configurar config.js.", "loginStatus", true);
      return;
    }

    if (!window.supabase) {
      status("No se pudo cargar Supabase. Revisa tu conexión.", "loginStatus", true);
      return;
    }

    sb = window.supabase.createClient(
      cfg.SUPABASE_URL,
      cfg.SUPABASE_PUBLISHABLE_KEY
    );

    sb.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        user = null;
        active = null;

        if (channel) {
          sb.removeChannel(channel);
          channel = null;
        }

        if (refreshTimer) {
          clearInterval(refreshTimer);
          refreshTimer = null;
        }

        hideGames();

        if (deleteChatBtn) {
          deleteChatBtn.style.display = "none";
          deleteChatBtn.hidden = true;
        }

        showLogin();
      }
    });

    const { data, error } = await sb.auth.getSession();

    if (error) throw error;

    if (data.session?.user) {
      await enter(data.session.user);
    } else {
      showLogin();
    }
  }

  // =========================================
  // BOTÓN GOOGLE
  // =========================================

  if ($("googleBtn")) {
    $("googleBtn").addEventListener("click", async () => {
      try {
        if (!sb) throw new Error("Supabase todavía no está listo.");

        const { error } = await sb.auth.signInWithOAuth({
          provider: "google",
          options: {
            redirectTo: location.origin + location.pathname
          }
        });

        if (error) throw error;

      } catch (error) {
        console.error("ERROR GOOGLE:", error);
        status(error.message, "loginStatus", true);
      }
    });
  }

  // =========================================
  // VALIDAR INVITACIÓN
  // =========================================

  if ($("inviteBtn")) {
    $("inviteBtn").addEventListener("click", async () => {
      try {
        if (!user) {
          status("Primero inicia sesión con Google.", "loginStatus", true);
          return;
        }

        const code = $("inviteInput")?.value.trim();

        if (!code) {
          status("Escribe la clave de invitación.", "loginStatus", true);
          return;
        }

        $("inviteBtn").disabled = true;
        status("Validando invitación...", "loginStatus");

        const { error } = await sb.rpc(
          "redeem_invite",
          { p_code: code }
        );

        if (error) throw error;

        const currentUser = await getAuthenticatedUser();
        await enter(currentUser);

      } catch (error) {
        console.error("ERROR INVITACIÓN:", error);
        status(error.message, "loginStatus", true);

      } finally {
        if ($("inviteBtn")) $("inviteBtn").disabled = false;
      }
    });
  }

  // =========================================
  // BUSCAR
  // =========================================

  if ($("searchUsersBtn")) {
    $("searchUsersBtn").addEventListener("click", searchUsers);
  }

  if ($("userSearchInput")) {
    $("userSearchInput").addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        searchUsers();
      }
    });
  }

  // =========================================
  // BOTONES DE GRUPOS
  // =========================================

  if ($("newGroupBtn")) {
    $("newGroupBtn").addEventListener("click", createGroup);
  }

  if ($("addGroupMemberBtn")) {
    $("addGroupMemberBtn").addEventListener("click", addGroupMember);
  }

  // =========================================
  // BOTÓN JUEGOS
  // =========================================

  if ($("gamesBtn")) {
    $("gamesBtn").addEventListener("click", showGames);
  }

  // =========================================
  // FORMULARIO DE MENSAJES
  // =========================================

  if ($("messageForm")) {
    $("messageForm").addEventListener("submit", event => {
      sendMessage(event).catch(error => {
        console.error("ERROR ENVIANDO MENSAJE:", error);
        status(error.message, "appStatus", true);
      });
    });
  }

  // =========================================
  // CERRAR SESIÓN
  // =========================================

  if ($("logoutBtn")) {
    $("logoutBtn").addEventListener("click", () => {
      logout().catch(error => {
        console.error("ERROR CERRANDO SESIÓN:", error);
        status(error.message, "appStatus", true);
      });
    });
  }

  // =========================================
  // EJECUTAR
  // =========================================

  init().catch(error => {
    console.error("ERROR INICIANDO FAMILYCHAT:", error);
    status(error.message, "loginStatus", true);
  });

})();
