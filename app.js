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

  // =========================================
  // MENSAJES Y UTILIDADES
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
      person.requester_id;
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

    if (!data.user) {
      throw new Error("No hay una sesión de usuario activa.");
    }

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
        throw new Error("No encontramos tu perfil en FamilyChat.");
      }

      if (!profile.invite_accepted) {
        showLogin();
        status(
          "Tu cuenta todavía necesita una invitación válida.",
          "loginStatus",
          true
        );
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

    } finally {
      entering = false;
    }
  }

  // =========================================
  // BUSCAR USUARIOS
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

      const users = data || [];

      if (!users.length) {
        results.textContent = term
          ? "No encontramos usuarios."
          : "No hay otros usuarios disponibles.";

        status("");
        return;
      }

      users.forEach(person => {
        const id = getPersonId(person);

        const alreadyAdded = contacts.some(
          contact => getPersonId(contact) === id
        );

        addPersonCard(
          results,
          person,
          alreadyAdded ? "Agregado" : "Agregar",
          alreadyAdded || !id
            ? null
            : () => sendFriendRequest(id),
          "Usuario de FamilyChat"
        );
      });

      status(`Se encontraron ${users.length} usuario(s).`);

    } catch (error) {
      console.error("Error buscando usuarios:", error);
      status("Error al buscar: " + error.message, "appStatus", true);

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
        loadRequests(),
        searchUsers()
      ]);

    } catch (error) {
      console.error(error);
      status("No se pudo enviar la solicitud: " + error.message, "appStatus", true);
    }
  }

  async function loadRequests() {
    const list = $("friendRequestsList");
    list.innerHTML = "";

    const { data, error } = await sb.rpc(
      "list_friend_requests"
    );

    if (error) {
      console.error("Error cargando solicitudes:", error);
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
      console.error(error);
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
      console.error("Error cargando contactos:", error);
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
      .select(
        "conversation_id,conversations(id,title,is_group,created_by)"
      )
      .eq("user_id", user.id);

    if (error) {
      console.error("Error cargando conversaciones:", error);
      status(error.message, "appStatus", true);
      return;
    }

    conversations = (data || [])
      .map(row => row.conversations)
      .filter(Boolean);

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

      const { data: conversation, error } = await sb
        .from("conversations")
        .insert({
          title: getPersonName(person),
          is_group: false,
          created_by: currentUser.id
        })
        .select()
        .single();

      if (error) throw error;

      const { error: memberError } = await sb
        .from("conversation_members")
        .insert({
          conversation_id: conversation.id,
          user_id: currentUser.id
        });

      if (memberError) throw memberError;

      const { error: otherMemberError } = await sb
        .from("conversation_members")
        .insert({
          conversation_id: conversation.id,
          user_id: otherId
        });

      if (otherMemberError) {
        console.error("Error agregando al contacto:", otherMemberError);
        status(
          "El chat se creó, pero Supabase no permitió agregar al otro usuario: " +
          otherMemberError.message,
          "appStatus",
          true
        );

        await loadConversations();
        return;
      }

      await loadConversations();
      await openChat(conversation);

    } catch (error) {
      console.error("Error creando chat:", error);
      status("No se pudo crear el chat: " + error.message, "appStatus", true);
    }
  }

  // =========================================
  // CREAR GRUPO
  // =========================================

  async function createGroup() {
    try {
      // Obtener el usuario real de Supabase.
      const currentUser = await getAuthenticatedUser();

      console.log("USUARIO AUTENTICADO:", currentUser.id);
      console.log("USUARIO DE LA APP:", user?.id);

      if (user && user.id !== currentUser.id) {
        throw new Error(
          "La sesión de FamilyChat no coincide con la sesión de Supabase. Recarga la página."
        );
      }

      const { data: profile, error: profileError } = await sb
        .from("profiles")
        .select("invite_accepted")
        .eq("id", currentUser.id)
        .maybeSingle();

      if (profileError) throw profileError;

      if (!profile || profile.invite_accepted !== true) {
        throw new Error(
          "Tu cuenta no tiene una invitación aceptada."
        );
      }

      const title = prompt("¿Cómo se llamará el grupo?");

      if (!title || !title.trim()) return;

      const available = contacts.filter(
        person => getPersonId(person) &&
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
          "Escribe los números de las personas que quieres incluir, separados por comas.\n" +
          "Déjalo vacío para crear el grupo solo contigo.\n\n" +
          options
        );

        if (answer === null) return;

        if (answer.trim()) {
          const indexes = [
            ...new Set(
              answer.split(",").map(value => Number(value.trim()) - 1)
            )
          ];

          if (indexes.some(
            index =>
              !Number.isInteger(index) ||
              index < 0 ||
              index >= available.length
          )) {
            throw new Error("Uno de los números de contacto no es válido.");
          }

          selected = indexes.map(
            index => getPersonId(available[index])
          );
        }
      }

      // Crear la conversación usando el ID autenticado real.
      const { data: conversation, error: conversationError } = await sb
        .from("conversations")
        .insert({
          title: title.trim(),
          is_group: true,
          created_by: currentUser.id
        })
        .select()
        .single();

      if (conversationError) {
        console.error("ERROR CREANDO CONVERSACIÓN:", conversationError);
        throw conversationError;
      }

      // Agregar primero al creador.
      const { error: ownerError } = await sb
        .from("conversation_members")
        .insert({
          conversation_id: conversation.id,
          user_id: currentUser.id
        });

      if (ownerError) {
        console.error("ERROR AGREGANDO CREADOR:", ownerError);

        status(
          "El grupo se creó, pero no se pudo agregarte como miembro: " +
          ownerError.message,
          "appStatus",
          true
        );

        await loadConversations();
        return;
      }

      // Intentar agregar a los demás participantes.
      if (selected.length) {
        const memberRows = selected.map(id => ({
          conversation_id: conversation.id,
          user_id: id
        }));

        const { error: participantsError } = await sb
          .from("conversation_members")
          .insert(memberRows);

        if (participantsError) {
          console.error(
            "ERROR AGREGANDO PARTICIPANTES:",
            participantsError
          );

          await loadConversations();
          await openChat(conversation);

          status(
            "El grupo se creó, pero Supabase bloqueó la incorporación de los demás miembros. Hay que corregir la política RLS de conversation_members.",
            "appStatus",
            true
          );

          return;
        }
      }

      await loadConversations();
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

      const { error } = await sb
        .from("conversation_members")
        .insert({
          conversation_id: active.id,
          user_id: getPersonId(person)
        });

      if (error) throw error;

      await loadConversations();

      status(
        `¡${getPersonName(person)} fue agregado al grupo!`
      );

    } catch (error) {
      console.error("ERROR AGREGANDO MIEMBRO:", error);

      status(
        "Supabase no permitió agregar a esta persona: " +
        error.message,
        "appStatus",
        true
      );
    }
  }

  // =========================================
  // MENSAJES
  // =========================================

  async function openChat(conversation) {
    active = conversation;

    $("chatTitle").textContent =
      conversation.title || "Conversación";

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

  async function loadMessages() {
    if (!active) return;

    const { data, error } = await sb
      .from("messages")
      .select("*")
      .eq("conversation_id", active.id)
      .order("created_at", { ascending: true })
      .limit(200);

    if (error) {
      console.error("ERROR CARGANDO MENSAJES:", error);
      status(error.message, "appStatus", true);
      return;
    }

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

  async function sendMessage(event) {
    event.preventDefault();

    if (!active) return;

    const currentUser = await getAuthenticatedUser();
    const input = $("messageInput");
    const body = input.value.trim();

    if (!body) return;

    input.value = "";

    const { error } = await sb
      .from("messages")
      .insert({
        conversation_id: active.id,
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
  // CERRAR SESIÓN
  // =========================================

  async function logout() {
    if (channel) {
      await sb.removeChannel(channel);
      channel = null;
    }

    await sb.auth.signOut();

    user = null;
    active = null;
    contacts = [];
    conversations = [];

    showLogin();
  }

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

    // Actualizar contactos, solicitudes y conversaciones.
    window.setInterval(async () => {
      if (!user || busy) return;

      busy = true;

      try {
        await Promise.all([
          loadContacts(),
          loadRequests(),
          loadConversations()
        ]);
      } catch (error) {
        console.warn("Error actualizando FamilyChat:", error);
      } finally {
        busy = false;
      }
    }, 10000);
  }

  // =========================================
  // BOTONES
  // =========================================

  $("googleBtn").addEventListener("click", async () => {
    try {
      const { error } = await sb.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: location.origin + location.pathname
        }
      });

      if (error) throw error;

    } catch (error) {
      console.error(error);
      status(error.message, "loginStatus", true);
    }
  });

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
      console.error(error);
      status(error.message, "loginStatus", true);

    } finally {
      $("inviteBtn").disabled = false;
    }
  });

  $("searchUsersBtn").addEventListener(
    "click",
    searchUsers
  );

  $("userSearchInput").addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      searchUsers();
    }
  });

  $("newGroupBtn").addEventListener(
    "click",
    createGroup
  );

  $("addGroupMemberBtn").addEventListener(
    "click",
    addGroupMember
  );

  $("messageForm").addEventListener(
    "submit",
    event => {
      sendMessage(event).catch(error => {
        console.error(error);
        status(error.message, "appStatus", true);
      });
    }
  );

  $("logoutBtn").addEventListener("click", () => {
    logout().catch(error => {
      console.error(error);
      status(error.message, "appStatus", true);
    });
  });

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
