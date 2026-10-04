using Xunit;

namespace SonicRoom.Windows.Tests;

/// <summary>
/// PercentValue is what the screen reader actually speaks for every volume-style
/// slider, so its edge cases are worth pinning: the slider range is 0-200 with 100
/// as unity, and a bare number gives the user no way to tell a 150% boost from a
/// malformed control.
/// </summary>
public class I18nPercentValueTests
{
    [Fact]
    public void UnityPercentIsAnnouncedAsNormal()
    {
        I18n.Lang = "en";
        Assert.Equal("100 percent, normal", I18n.PercentValue(100));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(50)]
    [InlineData(150)]
    [InlineData(200)]
    public void OtherPercentsReadAsBarePercent(int percent)
    {
        I18n.Lang = "en";
        Assert.Equal($"{percent} percent", I18n.PercentValue(percent));
    }

    [Fact]
    public void FractionalValuesRoundToNearest()
    {
        I18n.Lang = "en";
        Assert.Equal("151 percent", I18n.PercentValue(150.6));
        Assert.Equal("149 percent", I18n.PercentValue(149.4));
    }

    [Fact]
    public void NearUnityStillCountsAsNormal()
    {
        // The slider steps by whole points, but a restored setting or a programmatic
        // set can land fractionally. 99.6 must not read as "99 percent", which would
        // sound like a small reduction the user never asked for.
        I18n.Lang = "en";
        Assert.Equal("100 percent, normal", I18n.PercentValue(99.6));
        Assert.Equal("100 percent, normal", I18n.PercentValue(100.4));
    }

    [Fact]
    public void ValueTracksTheActiveLanguage()
    {
        I18n.Lang = "es";
        var es = I18n.PercentValue(150);
        I18n.Lang = "fr";
        var fr = I18n.PercentValue(150);

        Assert.Equal("150 por ciento", es);
        Assert.Equal("150 pour cent", fr);
    }
}