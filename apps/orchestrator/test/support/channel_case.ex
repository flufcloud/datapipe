defmodule OrchestratorWeb.ChannelCase do
  use ExUnit.CaseTemplate

  using do
    quote do
      import Phoenix.ChannelTest

      @endpoint OrchestratorWeb.Endpoint
    end
  end
end
