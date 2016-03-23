"""Example of using hangups to send a chat message to a conversation."""

import asyncio

import hangups


# ID of the conversation to send the message to. Conversation IDs can be found
# in the hangups debug log by searching for "conversation_id".
CONVERSATION_ID = 'Ugxfu9QF7O2mjXLu_6N4AaABAQ'
# Plain-text content of the message to send.

# Path where OAuth refresh token is saved, allowing hangups to remember your
# credentials.
REFRESH_TOKEN_PATH = 'refresh_token.txt'


class ChatUI(object):
    """User interface for hangups."""

    def __init__(self):
        """Start the user interface."""

        # These are populated by on_connect when it's called.
        self._convs = {}  # {conversation_id: ConversationWidget}
        self._tabbed_window = None  # TabbedWindowWidget
        self._conv_list = None  # hangups.ConversationList
        self._user_list = None  # hangups.UserList

        try:
            cookies = hangups.auth.get_auth_stdin(refresh_token_path)
        except hangups.GoogleAuthError as e:
            sys.exit('Login failed ({})'.format(e))

        self._client = hangups.Client(cookies)
        self._client.on_connect.add_observer(self._on_connect)

        loop = asyncio.get_event_loop()
		loop.run_until_complete(self._client.connect())

    def _input_filter(self, keys, _):
        """Handle global keybindings."""
        if keys == [self._keys['menu']]:
            if self._urwid_loop.widget == self._tabbed_window:
                self._show_menu()
            else:
                self._hide_menu()
        elif keys == [self._keys['quit']]:
            self._on_quit()
        else:
            return keys

    def _show_menu(self):
        """Show the overlay menu."""
        # If the current widget in the TabbedWindowWidget has a menu,
        # overlay it on the TabbedWindowWidget.
        current_widget = self._tabbed_window.get_current_widget()
        if hasattr(current_widget, 'get_menu_widget'):
            menu_widget = current_widget.get_menu_widget(self._hide_menu)
            overlay = urwid.Overlay(menu_widget, self._tabbed_window,
                                    align='center', width=('relative', 80),
                                    valign='middle', height=('relative', 80))
            self._urwid_loop.widget = overlay

    def _hide_menu(self):
        """Hide the overlay menu."""
        self._urwid_loop.widget = self._tabbed_window

    def get_conv_widget(self, conv_id):
        """Return an existing or new ConversationWidget."""
        if conv_id not in self._convs:
            set_title_cb = (lambda widget, title:
                            self._tabbed_window.set_tab(widget, title=title))
            widget = ConversationWidget(self._client,
                                        self._conv_list.get(conv_id),
                                        set_title_cb,
                                        self._keys,
                                        self._datetimefmt)
            self._convs[conv_id] = widget
        return self._convs[conv_id]

    def add_conversation_tab(self, conv_id, switch=False):
        """Add conversation tab if not present, and optionally switch to it."""
        conv_widget = self.get_conv_widget(conv_id)
        self._tabbed_window.set_tab(conv_widget, switch=switch,
                                    title=conv_widget.title)

    def on_select_conversation(self, conv_id):
        """Called when the user selects a new conversation to listen to."""
        # switch to new or existing tab for the conversation
        self.add_conversation_tab(conv_id, switch=True)

    @asyncio.coroutine
    def _on_connect(self):
        """Handle connecting for the first time."""
        self._user_list, self._conv_list = (
            yield from hangups.build_user_conversation_list(self._client)
        )
        self._conv_list.on_event.add_observer(self._on_event)

        # show the conversation menu
        conv_picker = ConversationPickerWidget(self._conv_list,
                                               self.on_select_conversation,
                                               self._keys)
        self._tabbed_window = TabbedWindowWidget(self._keys)
        self._tabbed_window.set_tab(conv_picker, switch=True,
                                    title='Conversations')
        self._urwid_loop.widget = self._tabbed_window

    def _on_event(self, conv_event):
        """Open conversation tab for new messages & pass events to notifier."""
        conv = self._conv_list.get(conv_event.conversation_id)
        user = conv.get_user(conv_event.user_id)
        add_tab = all((
            isinstance(conv_event, hangups.ChatMessageEvent),
            not user.is_self,
            not conv.is_quiet,
        ))
        if add_tab:
            self.add_conversation_tab(conv_event.conversation_id)
        # Handle notifications
        if self._notifier is not None:
            self._notifier.on_event(conv, conv_event)

    def _on_quit(self):
        """Handle the user quitting the application."""
        future = asyncio.async(self._client.disconnect())
        future.add_done_callback(lambda future: future.result())

def main():
    """Main entry point."""

    try:
        ChatUI()
    except KeyboardInterrupt:
        sys.exit('Caught KeyboardInterrupt, exiting abnormally')
    except:
        # urwid will prevent some exceptions from being printed unless we use
        # print a newline first.
        print('')
        raise

if __name__ == '__main__':
	main()
