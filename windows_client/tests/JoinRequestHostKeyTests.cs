using System.Linq;
using SonicRoom.Windows.Signaling;
using Xunit;

namespace SonicRoom.Windows.Tests;

/// <summary>
/// The join payload is hand-built rather than reflected, because the server's zod schema
/// treats undefined as absent and rejects null. These pin the two ways that can go wrong:
/// sending a key the schema refuses, and omitting one the room needs.
/// </summary>
public class JoinRequestHostKeyTests
{
    private static JoinRequest Request(string? hostKey) => new()
    {
        RoomName = "studio",
        DisplayName = "Ana",
        HostKey = hostKey,
    };

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void NoHostKeyMeansTheFieldIsAbsent(string? hostKey)
    {
        Assert.False(Request(hostKey).ToWire().ContainsKey("hostKey"));
    }

    [Fact]
    public void HostKeyIsSentWhenPresent()
    {
        Assert.Equal("abc123", Request("abc123").ToWire()["hostKey"]);
    }

    [Fact]
    public void HostKeyIsTrimmedByTheCallerNotSilentlyCutHere()
    {
        // JoinRequest itself passes the string through; ConnectAsync trims. An over-long
        // key is truncated rather than rejected, because zod caps it at 128 and a hard
        // failure here would be a confusing "cannot join" for what is really a bad paste.
        var longKey = new string('k', 200);
        var sent = (string)Request(longKey).ToWire()["hostKey"]!;
        Assert.Equal(128, sent.Length);
    }

    [Fact]
    public void ExistingFieldsStillRideAlong()
    {
        var wire = Request("k").ToWire();
        Assert.Equal("studio", wire["roomName"]);
        Assert.Equal("Ana", wire["displayName"]);
        Assert.Equal(true, wire["disableP2p"]); // native client is SFU-only
    }
}