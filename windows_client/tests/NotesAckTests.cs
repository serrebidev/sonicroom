using System.Text.Json;
using SonicRoom.Windows.Signaling;
using Xunit;

namespace SonicRoom.Windows.Tests;

/// <summary>
/// The notes ack is the one place the shared-notes feature can fail silently: a refused
/// <c>open-notes</c> still arrives as a normal ack, so nothing throws and the button would
/// do nothing visible. These pin the three refusals apart from success.
/// </summary>
public class NotesAckTests
{
    private static OpenNotesAck Parse(string json) => JsonSerializer.Deserialize<OpenNotesAck>(json)!;

    [Fact]
    public void SuccessCarriesTheUrl()
    {
        var ack = Parse("""{"ok":true,"url":"https://notes.example/room/abc"}""");
        Assert.True(ack.Ok);
        Assert.Equal("https://notes.example/room/abc", ack.Url);
    }

    [Theory]
    [InlineData("forbidden")]
    [InlineData("notes_disabled")]
    [InlineData("notes_failed")]
    public void RefusalIsOkFalseWithACode(string code)
    {
        // The client maps each code to its own announcement, so the codes must survive
        // deserialization rather than collapsing into one generic failure.
        var ack = Parse($$"""{"ok":false,"error":"{{code}}"}""");
        Assert.False(ack.Ok);
        Assert.Equal(code, ack.Error);
        Assert.Null(ack.Url);
    }

    [Fact]
    public void RefusalWithoutAUrlIsNotOpenable()
    {
        var ack = Parse("""{"ok":false,"error":"notes_disabled"}""");
        Assert.True(string.IsNullOrEmpty(ack.Url));
    }

    [Fact]
    public void NotesUpdatedCarriesUrlAndAuthor()
    {
        var ev = JsonSerializer.Deserialize<NotesUpdated>(
            """{"url":"https://notes.example/room/abc","by":"Ana"}""")!;
        Assert.Equal("https://notes.example/room/abc", ev.Url);
        Assert.Equal("Ana", ev.By);
    }

    [Fact]
    public void JoinAckReadsNotesAvailabilityAndUrl()
    {
        var ack = JsonSerializer.Deserialize<JoinAck>(
            """{"ok":true,"notesEnabled":true,"notesUrl":"https://notes.example/x"}""")!;
        Assert.True(ack.NotesEnabled);
        Assert.Equal("https://notes.example/x", ack.NotesUrl);
    }
}