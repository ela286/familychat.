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

  const msg = (text, id = "loginStatus", bad = false) => {
    const el = $(id);
    if (!el) return;
    el.textContent = text;
    el.style.color = bad ? "#bd4545" : "var(--purple)";
  };

  const ready = () =>
    typeof cfg.SUPABASE_URL === "string" &&
    cfg.SUPABASE_URL.startsWith("https://") &&
    typeof cfg.SUPABASE_PUBLISHABLE_KEY === "string" &&
    cfg.SUPABASE_PUBLISHABLE_KEY.length > 10;

  function showLogin() {
    $("loginView").classList.remove("hidden");
    $("appView").classList.add("hidden");
  }

  function showApp() {
    $("loginView").classList.add("hidden");
    $("appView").classList.remove("hidden");
  }

  async function enter(u) {
    user = u;

    const { data: profile, error } = await sb
      .from("profiles")
      .select("*")
      .eq("id", u.id)
      .maybeSingle();

    if (error) throw error;

    if (!profile?.invite_accepted) {
      showLogin();
      msg("Introduce la clave de invitación después de iniciar sesión con Google.");
      return;
    }

    $("profileName").textContent =
      profile.display_name || u.user_metadata?.full_name || "Usuario";

    $("profileEmail").textContent = u.email || "";

    $("avatar").src =
      profile.avatar_url || u.user_metadata?.avatar_url || "icon.svg";

    showApp();

    await Promise.all([
      loadConversations(),
      loadContacts(),
      loadRequests()
    ]);
  }

  function personId(person) {
    return person.id ||
      person.user_id ||
      person.contact_id ||
      person.requester_id;
  }

  function personName(person) {
    return person.display_name ||
      person.username ||
      person.name ||
      "Usuario";
  }

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
    name.textContent = personName(person);

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
    const button = $("searchUsersBtn");

    results.innerHTML = "";
    button.disabled = true;

    msg("Cargando usuarios...", "appStatus");

    try {
      const { data, error } = await sb.rpc(
        "search_familychat_users",
        {
          p_search: term
        }
      );

      if (error) throw error;

      const users = data || [];

      if (!users.length) {
        const empty = document.createElement("p");
        empty.className = "muted small";

        empty.textContent = term
          ? "No encontramos usuarios con ese nombre."
          : "Todavía no hay otros usuarios que hayan aceptado la invitación.";

        results.append(empty);
        msg("", "appStatus");
        return;
      }

      users.forEach(person => {
        const id = personId(person);

        const alreadyAdded = contacts.some(
          c => personId(c) === id
        );

        addPersonCard(
          results,
          person,
          alreadyAdded ? "Agregado" : "Agregar",
          alreadyAdded || !id
            ? null
            : () => sendFriendRequest(id),
          person.online === true
            ? "En línea"
            : "Usuario de FamilyChat"
        );
      });

      msg(
        `Se encontraron ${users.length} usuario(s).`,
        "appStatus"
      );

    } catch (error) {
      console.error(error);

      msg(
        "Error al buscar usuarios: " + error.message,
        "appStatus",
        true
      );

    } finally {
      button.disabled = false;
    }
  }

  async function sendFriendRequest(recipientId) {
    try {
      const { error } = await sb.rpc(
        "send_friend_request",
        {
          p_recipient_id: recipientId
        }
      );

      if (error) throw error;

      msg("¡Solicitud enviada!", "appStatus");

      await Promise.all([
        loadContacts(),
        loadRequests(),
        searchUsers()
      ]);

    } catch (error) {
      msg(
        "No se pudo enviar la solicitud: " + error.message,
        "appStatus",
        true
      );
    }
  }

  async function loadRequests() {
    const list = $("friendRequestsList");
    const count = $("requestCount");

    list.innerHTML = "";

    const { data, error } = await sb.rpc(
      "list_friend_requests"
    );

    if (error) {
      list.textContent =
        "No se pudieron cargar las solicitudes.";

      console.error(error);
      return;
    }

    const requests = data || [];

    count.textContent = requests.length
      ? `(${requests.length})`
      : "";

    if (!requests.length) {
      list.textContent =
        "No tienes solicitudes pendientes.";

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

      msg(
        accept
          ? "¡Contacto agregado!"
          : "Solicitud rechazada.",
        "appStatus"
      );

      await Promise.all([
        loadRequests(),
        loadContacts(),
        loadConversations()
      ]);

    } catch (error) {
      msg(error.message, "appStatus", true);
    }
  }

  async function loadContacts() {
    const list = $("contactsList");

    list.innerHTML = "";

    const { data, error } = await sb.rpc(
      "list_familychat_contacts"
    );

    if (error) {
      list.textContent =
        "No se pudieron cargar los contactos.";

      console.error(error);
      return;
    }

    contacts = data || [];

    if (!contacts.length) {
      list.textContent =
        "Todavía no tienes contactos.";

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

  async function loadConversations() {
    const { data, error } = await sb
      .from("conversation_members")
      .select(
        "conversation_id,conversations(id,title,is_group,created_by)"
      )
      .eq("user_id", user.id);

    if (error) {
      msg(error.message, "appStatus", true);
      return;
    }

    conversations = (data || [])
      .map(row => row.conversations)
      .filter(Boolean);

    const list = $("conversationList");

    list.innerHTML = "";

    if (!conversations.length) {
      list.innerHTML =
        '<p class="muted small">Todavía no tienes conversaciones.</p>';

      return;
    }

    conversations.forEach(conversation => {
      const button = document.createElement("button");

      button.className =
        "conversation-item" +
        (active?.id === conversation.id ? " active" : "");

      const icon = document.createElement("span");

      icon.className = "conversation-avatar";

      icon.textContent = conversation.is_group
        ? "👥"
        : "💬";

      const title = document.createElement("strong");

      title.textContent = conversation.title;

      button.append(icon, title);

      button.addEventListener(
        "click",
        () => openChat(conversation)
      );

      list.append(button);
    });
  }

  async function createPrivateChat(person) {
    const otherId = personId(person);

    if (!otherId) {
      msg(
        "No se encontró el identificador del contacto.",
        "appStatus",
        true
      );

      return;
    }

    try {
      const { data: conversation, error } = await sb
        .from("conversations")
        .insert({
          title: personName(person),
          is_group: false,
          created_by: user.id
        })
        .select()
        .single();

      if (error) throw error;

      const { error: memberError } = await sb
        .from("conversation_members")
        .insert([
          {
            conversation_id: conversation.id,
            user_id: user.id
          },
          {
            conversation_id: conversation.id,
            user_id: otherId
          }
        ]);

      if (memberError) throw memberError;

      await loadConversations();
      await openChat(conversation);

    } catch (error) {
      msg(
        "No se pudo crear el chat: " + error.message,
        "appStatus",
        true
      );
    }
  }

  async function openChat(conversation) {
    active = conversation;

    $("chatTitle").textContent = conversation.title;

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
        loadMessages
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
      .order("created_at")
      .limit(200);

    if (error) {
      msg(error.message, "appStatus", true);
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

      body.textContent = message.body;

      const time = document.createElement("small");

      time.textContent = new Date(
        message.created_at
      ).toLocaleString();

      item.append(body, time);

      box.append(item);
    });

    box.scrollTop = box.scrollHeight;
  }

  async function createGroup() {
    const title = prompt(
      "¿Cómo se llamará el grupo?"
    );

    if (!title?.trim()) return;

    try {
      const available = contacts.filter(
        person => personId(person)
      );

      let selected = [];

      if (available.length) {
        const options = available
          .map(
            (person, i) =>
              `${i + 1}. ${personName(person)}`
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
              answer
                .split(",")
                .map(value => Number(value.trim()) - 1)
            )
          ];

          if (
            indexes.some(
              index =>
                !Number.isInteger(index) ||
                index < 0 ||
                index >= available.length
            )
          ) {
            msg(
              "Hay un número de contacto no válido. No se creó el grupo.",
              "appStatus",
              true
            );

            return;
          }

          selected = indexes.map(
            index => personId(available[index])
          );
        }
      }

      const { data: conversation, error } = await sb
        .from("conversations")
        .insert({
          title: title.trim(),
          is_group: true,
          created_by: user.id
        })
        .select()
        .single();

      if (error) throw error;

      const memberRows = [
        user.id,
        ...selected
      ].map(userId => ({
        conversation_id: conversation.id,
        user_id: userId
      }));

      const { error: memberError } = await sb
        .from("conversation_members")
        .insert(memberRows);

      if (memberError) throw memberError;

      await loadConversations();

      await openChat(conversation);

      msg(
        "¡Grupo creado y participantes añadidos!",
        "appStatus"
      );

    } catch (error) {
      console.error("Error creando grupo:", error);

      msg(
        "No se pudo crear el grupo: " + error.message,
        "appStatus",
        true
      );
    }
  }

  async function addGroupMember() {
    if (!active?.is_group) return;

    if (!contacts.length) {
      msg(
        "Primero agrega contactos.",
        "appStatus",
        true
      );

      return;
    }

    try {
      const { data: currentMembers, error: membersError } =
        await sb
          .from("conversation_members")
          .select("user_id")
          .eq("conversation_id", active.id);

      if (membersError) throw membersError;

      const memberIds = new Set(
        (currentMembers || []).map(
          row => row.user_id
        )
      );

      const available = contacts.filter(
        person => !memberIds.has(personId(person))
      );

      if (!available.length) {
        msg(
          "Todos tus contactos ya están en este grupo.",
          "appStatus"
        );

        return;
      }

      const options = available
        .map(
          (person, i) =>
            `${i + 1}. ${personName(person)}`
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
        msg(
          "Número de contacto no válido.",
          "appStatus",
          true
        );

        return;
      }

      const contactId = personId(
        available[index]
      );

      const { error } = await sb
        .from("conversation_members")
        .insert({
          conversation_id: active.id,
          user_id: contactId
        });

      if (error) throw error;

      await loadConversations();

      msg(
        `¡${personName(available[index])} fue agregado al grupo!`,
        "appStatus"
      );

    } catch (error) {
      console.error(
        "Error agregando participante:",
        error
      );

      msg(
        "No se pudo agregar: " + error.message,
        "appStatus",
        true
      );
    }
  }

  async function sendMessage(event) {
    event.preventDefault();

    if (!active) return;

    const input = $("messageInput");

    const body = input.value.trim();

    if (!body) return;

    input.value = "";

    const { error } = await sb
      .from("messages")
      .insert({
        conversation_id: active.id,
        sender_id: user.id,
        body
      });

    if (error) {
      input.value = body;

      msg(
        error.message,
        "appStatus",
        true
      );
    }
  }

  async function logout() {
    if (channel) {
      await sb.removeChannel(channel);
    }

    await sb.auth.signOut();

    user = null;
    active = null;
    contacts = [];

    showLogin();
  }

  async function init() {
    if (!ready()) {
      msg(
        "Configura config.js con la URL y Publishable key de Supabase."
      );

      return;
    }

    if (!window.supabase) {
      msg(
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

    const { data, error } =
      await sb.auth.getSession();

    if (error) throw error;

    sb.auth.onAuthStateChange(
      (_event, session) => {
        if (session?.user) {
          enter(session.user).catch(
            err => msg(
              err.message,
              "loginStatus",
              true
            )
          );
        } else {
          user = null;
          showLogin();
        }
      }
    );

    if (data.session?.user) {
      await enter(data.session.user);
    } else {
      showLogin();
    }

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
        console.warn(
          "No se pudo actualizar FamilyChat:",
          error
        );

      } finally {
        busy = false;
      }

    }, 10000);
  }

  $("googleBtn").addEventListener(
    "click",
    async () => {
      try {
        const { error } =
          await sb.auth.signInWithOAuth({
            provider: "google",
            options: {
              redirectTo:
                location.origin + location.pathname
            }
          });

        if (error) throw error;

      } catch (error) {
        msg(
          error.message,
          "loginStatus",
          true
        );
      }
    }
  );

  $("inviteBtn").addEventListener(
    "click",
    async () => {
      if (!user) {
        msg(
          "Primero inicia sesión con Google."
        );

        return;
      }

      const code = $("inviteInput").value.trim();

      if (!code) {
        msg("Escribe la clave de invitación.");
        return;
      }

      const button = $("inviteBtn");

      button.disabled = true;

      try {
        msg("Validando invitación...");

        const { error } = await sb.rpc(
          "redeem_invite",
          {
            p_code: code
          }
        );

        if (error) throw error;

        msg("¡Invitación validada!");

        await enter(user);

      } catch (error) {
        msg(
          error.message,
          "loginStatus",
          true
        );

      } finally {
        button.disabled = false;
      }
    }
  );

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
    sendMessage
  );

  $("logoutBtn").addEventListener(
    "click",
    () => {
      logout().catch(
        error => msg(
          error.message,
          "appStatus",
          true
        )
      );
    }
  );

  init().catch(error => {
    console.error("FamilyChat:", error);

    msg(
      error.message,
      "loginStatus",
      true
    );
  });

})();
