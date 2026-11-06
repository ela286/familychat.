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

  // =========================================
  // CARGAR CONVERSACIONES
  // =========================================

  async function loadConversations() {
    if (!user) return;

    const { data, error } = await sb
      .from("conversation_members")
      .select(
        "conversation_id,conversations(id,title,is_group,created_by)"
      )
      .eq("user_id", user.id);

    if (error) {
      console.error("ERROR CARGANDO CONVERSACIONES:", error);
      status(error.message, "appStatus", true);
      return;
    }

    conversations = (data || [])
      .map(row => row.conversations)
      .filter(Boolean);

    if (
      active &&
      !conversations.some(item => item.id === active.id)
    ) {
      active = null;

      if (channel) {
        await sb.removeChannel(channel);
        channel = null;
      }

      $("messages").innerHTML = "";
      $("messages").classList.add("hidden");
      $("messageForm").classList.add("hidden");
      $("emptyState").classList.remove("hidden");
      $("chatTitle").textContent = "Selecciona un chat";

      if (deleteChatBtn) {
        deleteChatBtn.hidden = true;
      }
    }

    const list = $("conversationList");
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

      button.addEventListener(
        "click",
        () => openChat(conversation)
      );

      list.append(button);
    });
  }

  // =========================================
  // CREAR CHAT PRIVADO
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

      if (!conversationId) {
        throw new Error("Supabase no devolvió el ID del chat.");
      }

      await loadConversations();

      const conversation = conversations.find(
        item => item.id === conversationId
      );

      if (!conversation) {
        throw new Error("El chat se creó, pero no aparece en la lista.");
      }

      await openChat(conversation);

      status("¡Chat privado creado correctamente!");

    } catch (error) {
      console.error("ERROR CREANDO CHAT PRIVADO:", error);

      status(
        "No se pudo crear el chat: " + error.message,
        "appStatus",
        true
      );
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
          .map(
            (person, index) =>
              `${index + 1}. ${getPersonName(person)}`
          )
          .join("\n");

        const answer = prompt(
          "Escribe los números de los contactos que quieres incluir, separados por comas.\n" +
          "Déjalo vacío para crear el grupo solo contigo.\n\n" +
          options
        );

        if (answer === null) return;

        if (answer.trim()) {
          const indexes = [
            ...new Set(
              answer.split(",").map(
                value => Number(value.trim()) - 1
              )
            )
          ];

          if (indexes.some(
            index =>
              !Number.isInteger(index) ||
              index < 0 ||
              index >= available.length
          )) {
            throw new Error("Uno de los números no es válido.");
          }

          selected = indexes.map(
            index => getPersonId(available[index])
          );
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

      if (!conversationId) {
        throw new Error("Supabase no devolvió el ID del grupo.");
      }

      await loadConversations();

      const conversation = conversations.find(
        item => item.id === conversationId
      );

      if (!conversation) {
        throw new Error("El grupo se creó, pero no aparece en la lista.");
      }

      await openChat(conversation);

      status("¡Grupo creado correctamente!");

    } catch (error) {
      console.error("ERROR CREANDO GRUPO:", error);

      status(
        "No se pudo crear el grupo: " + error.message,
        "appStatus",
        true
      );
    }
  }

  // =========================================
  // AGREGAR PERSONAS A UN GRUPO
  // =========================================

  async function addGroupMember() {
    if (!active?.is_group) return;

    try {
      const currentUser = await getAuthenticatedUser();

      if (active.created_by !== currentUser.id) {
        throw new Error(
          "Solo quien creó el grupo puede agregar miembros."
        );
      }

      const { data: currentMembers, error: membersError } = await sb
        .from("conversation_members")
        .select("user_id")
        .eq("conversation_id", active.id);

      if (membersError) throw membersError;

      const memberIds = new Set(
        (currentMembers || []).map(row => row.user_id)
      );

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
        .map(
          (person, index) =>
            `${index + 1}. ${getPersonName(person)}`
        )
        .join("\n");

      const answer = prompt(
        "Escribe el número del contacto que quieres agregar:\n\n" +
        options
      );

      if (!answer) return;

      const index = Number(answer) - 1;

      if (
        !Number.isInteger(index) ||
        index < 0 ||
        index >= available.length
      ) {
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

      status(
        "No se pudo agregar a esta persona: " + error.message,
        "appStatus",
        true
      );
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

    deleteChatBtn.style.display = "none";
    deleteChatBtn.style.visibility = "visible";
    deleteChatBtn.style.background = "#8b3fa8";
    deleteChatBtn.style.color = "#ffffff";
    deleteChatBtn.style.border = "none";
    deleteChatBtn.style.borderRadius = "9px";
    deleteChatBtn.style.padding = "10px 14px";
    deleteChatBtn.style.margin = "10px 0 10px 12px";
    deleteChatBtn.style.cursor = "pointer";
    deleteChatBtn.style.fontWeight = "bold";
    deleteChatBtn.style.flexShrink = "0";

    deleteChatBtn.addEventListener("click", deleteActiveChat);

    return deleteChatBtn;
  }

  function showDeleteButton() {
    const button = createDeleteButton();
    const title = $("chatTitle");

    button.style.display = "inline-flex";
    button.style.visibility = "visible";
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

    $("chatTitle").textContent =
      conversation.title || "Conversación";

    showDeleteButton();

    $("emptyState").classList.add("hidden");
    $("messages").classList.remove("hidden");
    $("messageForm").classList.remove("hidden");

    $("addGroupMemberBtn").classList.toggle(
      "hidden",
      !conversation.is_group
    );

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
        {
          p_conversation_id: conversation.id
        }
      );

      if (error) throw error;

      if (data !== true) {
        throw new Error("Supabase no confirmó la eliminación.");
      }

      if (channel) {
        await sb.removeChannel(channel);
        channel = null;
      }

      active = null;

      $("messages").innerHTML = "";
      $("messages").classList.add("hidden");
      $("messageForm").classList.add("hidden");
      $("emptyState").classList.remove("hidden");
      $("chatTitle").textContent = "Selecciona un chat";

      deleteChatBtn.style.display = "none";
      deleteChatBtn.hidden = true;

      await loadConversations();

      status("Chat eliminado para todos.");

    } catch (error) {
      console.error("ERROR BORRANDO CHAT:", error);

      status(
        "No se pudo borrar el chat: " + error.message,
        "appStatus",
        true
      );

    } finally {
      if (deleteChatBtn) {
        deleteChatBtn.disabled = false;
      }
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
    const body = input.value.trim();

    if (!body) return;

    const conversationId = active.id;

    input.value = "";

    const { error } = await sb
      .from("messages")
      .insert({
        conversation_id: conversationId,
        sender_id: currentUser.id,
        body: body
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
  // ACTUALIZACIÓN AUTOMÁTICA
  // =========================================

  function startRefresh() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
    }

    refreshTimer = window.setInterval(async () => {
      if (!user || busy) return;

      busy = true;

      try {
        await Promise.all([
          loadContacts(),
          loadRequests(),
          loadConversations()
        ]);

        if (active) {
          await loadMessages();
        }

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

    stopPlatformGame();
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
      flex: 1 1 auto;
      min-height: 90px;
      max-height: none;
      overflow-y: auto;
      overscroll-behavior: contain;
      scrollbar-width: thin;
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
      opacity: 0.6;
      cursor: wait;
    }

    @media (max-width: 760px) {
      #conversationList {
        display: flex;
        flex-direction: column;
        flex: 1 1 150px;
        min-height: 100px;
        max-height: none;
        overflow-y: auto;
      }

      .conversation-item {
        width: 100%;
        min-width: 0;
        flex: 0 0 auto;
      }

      .sidebar {
        overflow-y: auto;
        overflow-x: hidden;
      }
    }
  `;

  document.head.appendChild(chatLayoutStyle);

  // =========================================
  // FAMILYCHAT ARCADE - AVENTURA PIXEL
  // =========================================

  let platformRunning = false;
  let platformFrame = null;
  let platformKeys = { left: false, right: false, jump: false };

  function showGames() {
    $("emptyState").classList.add("hidden");
    $("messages").classList.add("hidden");
    $("messageForm").classList.add("hidden");
    $("gamesPanel").classList.remove("hidden");
    $("appStatus").classList.add("hidden");
    startPlatformGame();
  }

  function hideGames() {
    stopPlatformGame();
    $("gamesPanel").classList.add("hidden");
    $("appStatus").classList.remove("hidden");

    if (active) {
      $("emptyState").classList.add("hidden");
      $("messages").classList.remove("hidden");
      $("messageForm").classList.remove("hidden");
    } else {
      $("emptyState").classList.remove("hidden");
      $("messages").classList.add("hidden");
      $("messageForm").classList.add("hidden");
    }
  }

  function startPlatformGame() {
    stopPlatformGame();

    const canvas = $("platformCanvas");
    const ctx = canvas.getContext("2d");
    const W = canvas.width;
    const H = canvas.height;
    const worldWidth = 2600;

    let score = 0;
    let lives = 3;
    let camera = 0;
    let finished = false;

    const player = {
      x: 55,
      y: 280,
      w: 26,
      h: 36,
      vx: 0,
      vy: 0,
      grounded: false
    };

    const platforms = [
      {x:0,y:355,w:worldWidth,h:60},
      {x:250,y:285,w:135,h:18},
      {x:485,y:235,w:135,h:18},
      {x:730,y:290,w:150,h:18},
      {x:1010,y:245,w:145,h:18},
      {x:1300,y:290,w:160,h:18},
      {x:1600,y:235,w:145,h:18},
      {x:1900,y:285,w:160,h:18}
    ];

    const coins = [
      280,520,770,1060,1350,1650,1950,2180
    ].map((x,i) => ({
      x,
      y:[245,195,250,205,250,195,245,300][i],
      taken:false
    }));

    const pipes = [
      {x:420,y:300,w:55,h:55},
      {x:920,y:305,w:60,h:50},
      {x:1510,y:295,w:60,h:60}
    ];

    const enemies = [
      {x:650,y:327,vx:1.3,alive:true},
      {x:1190,y:327,vx:1.5,alive:true},
      {x:1810,y:327,vx:1.7,alive:true}
    ];

    const goal = {x:2420,y:235,w:12,h:120};

    const hit = (a,b) =>
      a.x < b.x+b.w &&
      a.x+a.w > b.x &&
      a.y < b.y+b.h &&
      a.y+a.h > b.y;

    function update() {
      if (finished) return;

      player.vx =
        (platformKeys.right ? 4 : 0) -
        (platformKeys.left ? 4 : 0);

      if (platformKeys.jump && player.grounded) {
        player.vy = -11;
        player.grounded = false;
      }

      const oldY = player.y;

      player.x = Math.max(
        0,
        Math.min(worldWidth-player.w, player.x+player.vx)
      );

      player.vy = Math.min(12, player.vy + 0.48);
      player.y += player.vy;
      player.grounded = false;

      if (player.vy >= 0) {
        for (const p of platforms) {
          if (
            oldY+player.h <= p.y+5 &&
            player.y+player.h >= p.y &&
            player.x+player.w > p.x &&
            player.x < p.x+p.w
          ) {
            player.y = p.y-player.h;
            player.vy = 0;
            player.grounded = true;
          }
        }
      }

      if (player.y > H+80) {
        loseLife();
        return;
      }

      for (const c of coins) {
        if (
          !c.taken &&
          Math.abs((player.x+13)-c.x) < 19 &&
          Math.abs((player.y+15)-c.y) < 25
        ) {
          c.taken = true;
          score += 10;
        }
      }

      for (const e of enemies) {
        if (!e.alive) continue;

        e.x += e.vx;

        if (e.x < 560 || e.x > 2200) {
          e.vx *= -1;
        }

        if (hit(player,{x:e.x,y:e.y,w:27,h:27})) {
          if (player.vy > 0 && oldY+player.h <= e.y+12) {
            e.alive = false;
            player.vy = -7;
            score += 20;
          } else {
            loseLife();
            return;
          }
        }
      }

      if (hit(player,goal)) {
        finished = true;
        $("platformMessage").textContent =
          "🏆 ¡Ganaste! Pulsa Reiniciar para volver a jugar.";
      }

      camera = Math.max(
        0,
        Math.min(player.x-W*0.35,worldWidth-W)
      );

      $("gameScore").textContent = "Monedas: " + score;
      $("gameLives").textContent = "Vidas: " + lives;
      $("gameLevel").textContent = "Nivel: 1";
    }

    function loseLife() {
      lives--;
      $("gameLives").textContent = "Vidas: " + lives;

      if (lives <= 0) {
        finished = true;
        $("platformMessage").textContent =
          "💔 Fin del juego. Pulsa Reiniciar.";
      } else {
        player.x = Math.max(40,camera+40);
        player.y = 220;
        player.vy = 0;
      }
    }

    function draw() {
      ctx.fillStyle = "#8297f5";
      ctx.fillRect(0,0,W,H);

      // Nubes
      for (let i=0;i<8;i++) {
        let x = (i*260-camera*.35)%(W+100);
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(x,70,22,0,Math.PI*2);
        ctx.arc(x+25,60,28,0,Math.PI*2);
        ctx.arc(x+52,72,22,0,Math.PI*2);
        ctx.fill();
      }

      ctx.save();
      ctx.translate(-camera,0);

      // Colinas
      for (let i=0;i<10;i++) {
        ctx.fillStyle = "#49b832";
        ctx.beginPath();
        ctx.arc(i*300+100,365,95,Math.PI,0);
        ctx.fill();
      }

      // Plataformas
      for (const p of platforms) {
        ctx.fillStyle = "#b96c32";
        ctx.fillRect(p.x,p.y,p.w,p.h);
        ctx.strokeStyle = "#39251e";
        ctx.lineWidth = 3;

        for (let x=p.x;x<p.x+p.w;x+=35) {
          ctx.strokeRect(x,p.y,35,18);
          ctx.strokeRect(x,p.y+18,35,18);
        }
      }

      // Tuberías
      for (const p of pipes) {
        ctx.fillStyle = "#20ad27";
        ctx.fillRect(p.x,p.y,p.w,p.h);
        ctx.fillStyle = "#77e83c";
        ctx.fillRect(p.x+9,p.y+8,12,p.h-8);
        ctx.strokeStyle = "#145e18";
        ctx.lineWidth = 4;
        ctx.strokeRect(p.x,p.y,p.w,p.h);
      }

      // Monedas
      for (const c of coins) {
        if (c.taken) continue;

        ctx.fillStyle = "#ffdc35";
        ctx.beginPath();
        ctx.ellipse(c.x,c.y,8,13,0,0,Math.PI*2);
        ctx.fill();
        ctx.strokeStyle = "#a76b16";
        ctx.stroke();
      }

      // Enemigos
      for (const e of enemies) {
        if (!e.alive) continue;

        ctx.fillStyle = "#8d3d9c";
        ctx.beginPath();
        ctx.arc(e.x+13,e.y+13,14,Math.PI,0);
        ctx.fill();
        ctx.fillRect(e.x,e.y+13,27,14);
        ctx.fillStyle = "#fff";
        ctx.fillRect(e.x+5,e.y+7,5,5);
        ctx.fillRect(e.x+17,e.y+7,5,5);
      }

      // Meta
      ctx.fillStyle = "#fff";
      ctx.fillRect(goal.x,goal.y,5,120);
      ctx.fillStyle = "#e64d6a";
      ctx.beginPath();
      ctx.moveTo(goal.x+5,goal.y);
      ctx.lineTo(goal.x+55,goal.y+20);
      ctx.lineTo(goal.x+5,goal.y+40);
      ctx.fill();

      // Personaje original
      ctx.fillStyle = "#63399b";
      ctx.fillRect(player.x+4,player.y,20,9);
      ctx.fillStyle = "#f2bd8b";
      ctx.fillRect(player.x+5,player.y+8,18,12);
      ctx.fillStyle = "#e94c52";
      ctx.fillRect(player.x,player.y+20,27,13);
      ctx.fillStyle = "#292730";
      ctx.fillRect(player.x+4,player.y+32,8,4);
      ctx.fillRect(player.x+17,player.y+32,8,4);

      ctx.restore();
    }

    function loop() {
      if (!platformRunning) return;

      update();
      draw();

      if (!finished) {
        platformFrame = requestAnimationFrame(loop);
      }
    }

    platformRunning = true;
    platformKeys = {left:false,right:false,jump:false};

    $("gameScore").textContent = "Monedas: 0";
    $("gameLives").textContent = "Vidas: 3";
    $("gameLevel").textContent = "Nivel: 1";
    $("platformMessage").textContent =
      "¡A jugar! Usa las flechas o los botones para moverte y saltar.";

    loop();
  }

  function stopPlatformGame() {
    platformRunning = false;

    if (platformFrame) {
      cancelAnimationFrame(platformFrame);
    }

    platformFrame = null;
    platformKeys = {left:false,right:false,jump:false};
  }

  function bindGameHold(id,key) {
    const element = $(id);

    element.addEventListener("pointerdown",event => {
      event.preventDefault();
      platformKeys[key] = true;
    });

    ["pointerup","pointerleave","pointercancel"].forEach(eventName => {
      element.addEventListener(eventName,() => {
        platformKeys[key] = false;
      });
    });
  }

  bindGameHold("gameLeft","left");
  bindGameHold("gameRight","right");
  bindGameHold("gameJump","jump");

  document.addEventListener("keydown",event => {
    if (!platformRunning) return;

    if (["ArrowLeft","a","A"].includes(event.key)) {
      platformKeys.left = true;
    }

    if (["ArrowRight","d","D"].includes(event.key)) {
      platformKeys.right = true;
    }

    if (["ArrowUp","w","W"," "].includes(event.key)) {
      platformKeys.jump = true;
      event.preventDefault();
    }
  });

  document.addEventListener("keyup",event => {
    if (["ArrowLeft","a","A"].includes(event.key)) {
      platformKeys.left = false;
    }

    if (["ArrowRight","d","D"].includes(event.key)) {
      platformKeys.right = false;
    }

    if (["ArrowUp","w","W"," "].includes(event.key)) {
      platformKeys.jump = false;
    }
  });

  $("restartPlatformGame").addEventListener(
    "click",
    startPlatformGame
  );

  $("gamesBtn").addEventListener("click",showGames);
  $("backToChatBtn").addEventListener("click",hideGames);

  // =========================================
  // INICIAR APLICACIÓN
  // =========================================

  async function init() {
    if (
      !cfg.SUPABASE_URL ||
      !cfg.SUPABASE_PUBLISHABLE_KEY
    ) {
      status(
        "Falta configurar config.js.",
        "loginStatus",
        true
      );
      return;
    }

    if (!window.supabase) {
      status(
        "No se pudo cargar Supabase. Revisa tu conexión.",
        "loginStatus",
        true
      );
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

        if (deleteChatBtn) {
          deleteChatBtn.style.display = "none";
          deleteChatBtn.hidden = true;
        }

        stopPlatformGame();
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

  // =========================================
  // VALIDAR INVITACIÓN
  // =========================================

  $("inviteBtn").addEventListener("click", async () => {
    try {
      if (!user) {
        status(
          "Primero inicia sesión con Google.",
          "loginStatus",
          true
        );
        return;
      }

      const code = $("inviteInput").value.trim();

      if (!code) {
        status(
          "Escribe la clave de invitación.",
          "loginStatus",
          true
        );
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
      $("inviteBtn").disabled = false;
    }
  });

  // =========================================
  // BOTÓN BUSCAR
  // =========================================

  $("searchUsersBtn").addEventListener(
    "click",
    searchUsers
  );

  $("userSearchInput").addEventListener(
    "keydown",
    event => {
      if (event.key === "Enter") {
        event.preventDefault();
        searchUsers();
      }
    }
  );

  // =========================================
  // BOTONES DE GRUPOS
  // =========================================

  $("newGroupBtn").addEventListener(
    "click",
    createGroup
  );

  $("addGroupMemberBtn").addEventListener(
    "click",
    addGroupMember
  );

  // =========================================
  // FORMULARIO DE MENSAJES
  // =========================================

  $("messageForm").addEventListener(
    "submit",
    event => {
      sendMessage(event).catch(error => {
        console.error("ERROR ENVIANDO MENSAJE:", error);
        status(error.message, "appStatus", true);
      });
    }
  );

  // =========================================
  // CERRAR SESIÓN
  // =========================================

  $("logoutBtn").addEventListener(
    "click",
    () => {
      logout().catch(error => {
        console.error("ERROR CERRANDO SESIÓN:", error);
        status(error.message, "appStatus", true);
      });
    }
  );

  // =========================================
  // EJECUTAR
  // =========================================

  init().catch(error => {
    console.error("ERROR INICIANDO FAMILYCHAT:", error);

    status(
      error.message,
      "loginStatus",
      true
    );
  });

})();
